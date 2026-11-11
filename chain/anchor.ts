// Verify TEE receipts from BRIEFs, combine them into one Merkle root, write it to NEAR testnet (SocialDB).
// Guardrails: at least MIN_BATCH (10) briefs, newest brief at least 48h old, count published as a bucket, week-level date.
// Usage: bun anchor.ts [--now]   (--now skips the 48h delay, for the hackathon demo only; the 10-brief minimum still applies)
// Signing key: env near_impact_key ("ed25519:...") or ~/.near-credentials/testnet/<account>.json. Neither → dry run.
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { verifyMessage } from "ethers";
import { Account, KeyPair, keyStores, connect, utils } from "near-api-js";
import { ACCOUNT, SOCIAL, MIN_BATCH, bucket, merkleRoot, attestedSigners, leaf, type Receipt } from "./lib";

const DATA = "/home/workspace/Paper-Trail/data";
const DELAY_MS = 48 * 3600 * 1000;
const now = process.argv.includes("--now");

const monday = (d: Date) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t; };
const isoWeek = (d: Date) => {
  const t = monday(d); t.setUTCDate(t.getUTCDate() + 3);
  const y = t.getUTCFullYear(); const w1 = monday(new Date(Date.UTC(y, 0, 4)));
  return `${y}-W${String(1 + Math.round((+t - 3 * 864e5 - +w1) / (7 * 864e5))).padStart(2, "0")}`;
};

type Row = Receipt & { at?: string; day: string; lang: string };
const when = (r: Row) => new Date(r.at || `${r.day}T23:59:59Z`);
const rows: Row[] = existsSync(`${DATA}/receipts.jsonl`)
  ? readFileSync(`${DATA}/receipts.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const batches: any[] = existsSync(`${DATA}/batches.json`) ? JSON.parse(readFileSync(`${DATA}/batches.json`, "utf8")) : [];
const done = new Set(batches.flatMap((b) => b.leaves as string[]));

const seen = new Set<string>();
const pending = rows.filter((r) => {
  if (!r.rid) return false;
  const k = leaf(r).toString("hex");
  if (done.has(k) || seen.has(k)) return false;
  seen.add(k);
  return true;
});

const signers = new Map<string, Set<string>>();
const valid: Row[] = [];
for (const r of pending) {
  if (!signers.has(r.model)) signers.set(r.model, await attestedSigners(r.model, process.env.near_key!));
  const ok = verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase()
    && signers.get(r.model)!.has(r.signing_address.toLowerCase());
  if (ok) valid.push(r); else console.log("rejected receipt (signature or attestation mismatch)");
}
const newest = valid.length ? Math.max(...valid.map((r) => +when(r))) : 0;
const waitH = Math.ceil((newest + DELAY_MS - Date.now()) / 3600e3);
if (valid.length < MIN_BATCH || (!now && waitH > 0)) {
  console.log(JSON.stringify({ anchored: false, pending: valid.length, need: MIN_BATCH, ...(waitH > 0 && !now ? { wait_hours: waitH } : {}) }));
  process.exit(0);
}

const first = new Date(Math.min(...valid.map((r) => +when(r))));
const week = isoWeek(first);
const id = `${week}-${String(batches.filter((b) => b.id.startsWith(week)).length + 1).padStart(2, "0")}`;
const record = {
  v: 2, batch_id: id, merkle_root: merkleRoot(valid), count_bucket: bucket(valid.length),
  week_of: monday(first).toISOString().slice(0, 10),
  models: [...new Set(valid.map((r) => r.model))],
  signers: [...new Set(valid.map((r) => r.signing_address.toLowerCase()))],
};

const credFile = `${homedir()}/.near-credentials/testnet/${ACCOUNT}.json`;
const key = process.env.near_impact_key || (existsSync(credFile) ? JSON.parse(readFileSync(credFile, "utf8")).private_key : "");
if (!key) {
  mkdirSync(`${DATA}/impact`, { recursive: true });
  appendFileSync(`${DATA}/impact/dryrun.log`, JSON.stringify({ at: new Date().toISOString(), would_write: record, briefs: valid.length }) + "\n");
  console.log(JSON.stringify({ anchored: false, dry_run: true, record, log: `${DATA}/impact/dryrun.log` }));
  process.exit(0);
}

const ks = new keyStores.InMemoryKeyStore();
await ks.setKey("testnet", ACCOUNT, KeyPair.fromString(key as any));
const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.near.org", keyStore: ks });
const acct = new Account(near.connection, ACCOUNT);
const out: any = await acct.functionCall({
  contractId: SOCIAL, methodName: "set",
  args: { data: { [ACCOUNT]: { papertrail: { batch: { [id]: JSON.stringify(record) } } } } },
  gas: 100_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.05")!),
});
const tx = out.transaction_outcome.id;

const langs: Record<string, number> = {};
for (const r of valid) langs[r.lang] = (langs[r.lang] || 0) + 1;
writeFileSync(`${DATA}/public/batch-${id}.json`, JSON.stringify({ id, ...record, tx, receipts: valid.map(({ rid, model, text, signature, signing_address }) => ({ rid, model, text, signature, signing_address })) }, null, 1));
batches.push({ id, ...record, tx, briefs: valid.length, langs, anchoredAt: new Date().toISOString().slice(0, 10), leaves: valid.map((r) => leaf(r).toString("hex")) });
writeFileSync(`${DATA}/batches.json`, JSON.stringify(batches, null, 1));
console.log(JSON.stringify({ anchored: true, id, count_bucket: record.count_bucket, root: record.merkle_root, tx, explorer: `https://testnet.nearblocks.io/txns/${tx}` }));
