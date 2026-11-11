// zo.space API route: /api/papertrail/pledge
// POST {"amount": 25|50|100} → writes an anonymous testnet pledge to NEAR (no money moves), returns it.
// GET ?id=PT-XXXXXXXX → one pledge.  GET → totals (briefs funded vs. verified briefs available).
import type { Context } from "hono";
import { readFileSync, existsSync } from "node:fs";

const ROOT = "/home/workspace/Paper-Trail";
const DATA = `${ROOT}/data`;
const readJson = (p: string, d: any) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const funded = (p: any) => p.funds.reduce((n: number, a: any) => n + a.leaves.length, 0);
const view = (p: any) => ({
  v: 1, pledge_id: p.id, amount_usd: p.amount_usd, briefs: p.briefs, week_of: p.week_of,
  status: funded(p) >= p.briefs ? "matched" : funded(p) ? "partly matched" : "waiting for the next batch",
  funds: p.funds,
  tx: p.tx.map((t: string) => ({ tx: t, explorer: `https://testnet.nearblocks.io/txns/${t}` })),
  track: `https://kikib.zo.space/papertrail?pledge=${p.id}`,
});

export default async (c: Context) => {
  if (c.req.method === "POST") {
    const body = await c.req.json().catch(() => ({}));
    const amount = Number(body?.amount);
    if (![25, 50, 100].includes(amount)) return c.json({ error: "amount must be 25, 50 or 100" }, 400);
    const proc = Bun.spawn([process.execPath, "pledge.ts", "new", String(amount)], { cwd: `${ROOT}/chain`, stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(proc.stdout).text()).trim().split("\n").pop() || "{}";
    await proc.exited;
    let j: any;
    try { j = JSON.parse(out); } catch { j = { error: "pledge failed" }; }
    if (j.error) { console.error("papertrail pledge", j.error, (await new Response(proc.stderr).text()).slice(0, 300)); return c.json({ error: j.error }, 429); }
    const p = readJson(`${DATA}/pledges.json`, []).find((x: any) => x.id === j.pledge_id);
    return c.json(p ? view(p) : j, 201);
  }
  const all = readJson(`${DATA}/pledges.json`, []);
  const id = c.req.query("id");
  if (id) {
    if (!/^PT-[0-9A-F]{8}$/.test(id)) return c.json({ error: "bad pledge id" }, 400);
    const p = all.find((x: any) => x.id === id);
    return p ? c.json(view(p)) : c.json({ error: "not found" }, 404);
  }
  const fundable = readJson(`${DATA}/batches.json`, []).filter((b: any) => b.v === 2).reduce((n: number, b: any) => n + b.leaves.length, 0);
  return c.json({
    pledges: all.length,
    usd_pledged: all.reduce((n: number, p: any) => n + p.amount_usd, 0),
    briefs_funded: all.reduce((n: number, p: any) => n + funded(p), 0),
    briefs_verified: fundable,
    waiting: all.filter((p: any) => funded(p) < p.briefs).length,
  });
};
