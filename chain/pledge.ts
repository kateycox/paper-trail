// Testnet sponsorship pledges. No money moves: a pledge is a public, anonymous promise that is matched to
// specific TEE-signed briefs that were already delivered and anchored in a batch on NEAR (pay for proven results).
// Each brief (leaf) can be funded by exactly one pledge, and anyone can check that on-chain.
//
// Usage:
//   bun pledge.ts new <amount_usd>   create a pledge ($1 funds one brief), match it, write it to NEAR
//   bun pledge.ts match              match waiting pledges against unfunded briefs (anchor.ts runs this after each batch)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { Account, KeyPair, keyStores, connect, utils } from "near-api-js";
import { ACCOUNT, SOCIAL } from "./lib";

const DATA = "/home/workspace/Paper-Trail/data";
const FILE = `${DATA}/pledges.json`;
const LOCK = `${DATA}/.pledge.lock`;
export const PRICE_PER_BRIEF = 1;
export const AMOUNTS = [1, 3, 5];
const MAX_PER_HOUR = 30;
const MAX_WAITING = 50;

type Alloc = { batch_id: string; leaves: string[] };
export type Pledge = { id: string; amount_usd: number; briefs: number; created: string; week_of: string; funds: Alloc[]; tx: string[] };

const load = (): Pledge[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (p: Pledge[]) => writeFileSync(FILE, JSON.stringify(p, null, 1));
const batches = (): any[] => (existsSync(`${DATA}/batches.json`) ? JSON.parse(readFileSync(`${DATA}/batches.json`, "utf8")) : []);
const funded = (p: Pledge) => p.funds.reduce((n, a) => n + a.leaves.length, 0);
const monday = (d: Date) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

async function lock<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { mkdirSync(LOCK); break; } catch { if (i > 300) throw new Error("pledge lock busy"); await Bun.sleep(100); }
  }
  try { return await fn(); } finally { rmdirSync(LOCK); }
}

// Newest verified batch first (a gift funds this week's proven work). Pilot batch b1 (v1, before receipt ids) is not fundable.
function allocate(all: Pledge[]) {
  const taken = new Set(all.flatMap((p) => p.funds.flatMap((a) => a.leaves)));
  const pledges = all.filter((p) => funded(p) < p.briefs);
  const free: { batch_id: string; leaf: string }[] = [];
  for (const b of batches().reverse()) if (b.v >= 2) for (const l of b.leaves) if (!taken.has(l)) free.push({ batch_id: b.id, leaf: l });
  const changed: Pledge[] = [];
  for (const p of pledges) {
    let need = p.briefs - funded(p);
    if (need <= 0) continue;
    const got = free.splice(0, need);
    if (!got.length) break;
    for (const g of got) {
      let a = p.funds.find((x) => x.batch_id === g.batch_id);
      if (!a) p.funds.push((a = { batch_id: g.batch_id, leaves: [] }));
      a.leaves.push(g.leaf);
    }
    changed.push(p);
  }
  return changed;
}

export const onChain = (p: Pledge) => ({
  v: 1, pledge_id: p.id, amount_usd: p.amount_usd, briefs: p.briefs, week_of: p.week_of,
  status: funded(p) >= p.briefs ? "matched" : funded(p) ? "partly matched" : "waiting for the next batch",
  funds: p.funds,
});

async function write(ps: Pledge[]) {
  if (!ps.length) return null;
  const credFile = `${homedir() || "/root"}/.near-credentials/testnet/${ACCOUNT}.json`;
  const key = process.env.near_impact_key || (existsSync(credFile) ? JSON.parse(readFileSync(credFile, "utf8")).private_key : "");
  const pledge = Object.fromEntries(ps.map((p) => [p.id, JSON.stringify(onChain(p))]));
  if (!key) {
    mkdirSync(`${DATA}/impact`, { recursive: true });
    appendFileSync(`${DATA}/impact/dryrun.log`, JSON.stringify({ at: new Date().toISOString(), would_write: { pledge } }) + "\n");
    return "dry-run";
  }
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey("testnet", ACCOUNT, KeyPair.fromString(key as any));
  const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.near.org", keyStore: ks });
  const out: any = await new Account(near.connection, ACCOUNT).functionCall({
    contractId: SOCIAL, methodName: "set",
    args: { data: { [ACCOUNT]: { papertrail: { pledge } } } },
    gas: 100_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.01")!),
  });
  return out.transaction_outcome.id as string;
}

export async function newPledge(amount: number) {
  if (!AMOUNTS.includes(amount)) throw new Error(`amount must be one of ${AMOUNTS.join(", ")}`);
  return lock(async () => {
    const all = load();
    const hourAgo = Date.now() - 3600e3;
    if (all.filter((p) => +new Date(p.created) > hourAgo).length >= MAX_PER_HOUR) throw new Error("too many pledges this hour, try later");
    if (all.filter((p) => funded(p) < p.briefs).length >= MAX_WAITING) throw new Error("too many pledges are waiting for briefs, try later");
    const now = new Date();
    const p: Pledge = { id: `PT-${randomBytes(4).toString("hex").toUpperCase()}`, amount_usd: amount, briefs: amount / PRICE_PER_BRIEF, created: now.toISOString(), week_of: monday(now), funds: [], tx: [] };
    all.push(p);
    const changed = allocate(all);
    if (!changed.includes(p)) changed.push(p);
    const tx = await write(changed);
    if (tx) for (const x of changed) x.tx.push(tx);
    save(all);
    return { ...onChain(p), tx: p.tx };
  });
}

export async function matchWaiting() {
  return lock(async () => {
    const all = load();
    const changed = allocate(all);
    const tx = await write(changed);
    if (tx) for (const p of changed) p.tx.push(tx);
    save(all);
    return { updated: changed.map((p) => p.id), tx };
  });
}

if (import.meta.main) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "new") console.log(JSON.stringify(await newPledge(Number(arg))));
    else if (cmd === "match") console.log(JSON.stringify(await matchWaiting()));
    else { console.error("usage: bun pledge.ts new <1|3|5> | match"); process.exit(2); }
  } catch (e: any) {
    console.log(JSON.stringify({ error: String(e?.message || e) }));
    process.exit(1);
  }
}
