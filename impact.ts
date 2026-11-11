import type { Context } from "hono";
import { readFileSync, existsSync } from "node:fs";

const DATA = "/home/workspace/Paper-Trail/data";
const ACCOUNT = "papertrail-impact.testnet";

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

export default (c: Context) => {
  const spec = c.req.query("specimen");
  if (spec) {
    if (!/^[0-9a-f]{64}$/.test(spec)) return c.json({ error: "bad leaf" }, 400);
    const s = readJson(`${DATA}/public/specimen/${spec}.json`);
    return s ? c.json(s) : c.json({ error: "not a specimen brief: real briefs are never published" }, 404);
  }
  const id = c.req.query("batch");
  if (id) {
    if (!/^(b\d+|\d{4}-W\d{2}-\d{2})$/.test(id)) return c.json({ error: "bad batch id" }, 400);
    const b = readJson(`${DATA}/public/batch-${id}.json`);
    return b ? c.json(b) : c.json({ error: "not found" }, 404);
  }
  const all = readJson(`${DATA}/batches.json`) || [];
  const batches = all.map(({ leaves, langs, briefs, ...b }: any) => ({
    ...b,
    count_bucket: b.count_bucket ?? `${briefs} (pilot, before the 10-brief minimum)`,
    explorer: `https://testnet.nearblocks.io/txns/${b.tx}`,
    download: `https://kikib.zo.space/api/papertrail/impact?batch=${b.id}`,
  }));
  const total = all.reduce((n: number, b: any) => n + b.briefs, 0);
  const langs: Record<string, number> = {};
  for (const b of all) for (const [k, v] of Object.entries(b.langs || {})) langs[k] = (langs[k] || 0) + (v as number);
  const langShare = total > 100 ? Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, Math.round((100 * v) / total)])) : null;
  return c.json({
    account: ACCOUNT,
    network: "testnet",
    totals: { briefs: total, batches: batches.length, langShare },
    batches,
  });
};
