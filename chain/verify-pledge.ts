// Anyone can run this: traces a sponsorship pledge to the TEE-signed briefs it paid for, using only NEAR testnet and public receipts.
// Usage: bun verify-pledge.ts PT-XXXXXXXX
import { verifyMessage } from "ethers";
import { socialGet, merkleRoot, leaf, viewBatch } from "./lib";

const id = process.argv[2];
const raw = (await socialGet(`pledge/${id}`))?.pledge?.[id];
if (!raw) { console.log(`pledge ${id}: not found on NEAR`); process.exit(1); }
const p = JSON.parse(raw);
console.log(`pledge ${id}: $${p.amount_usd} for ${p.briefs} brief(s), ${p.status}`);

const all = (await socialGet("pledge/*"))?.pledge ?? {};
const claimedElsewhere = new Set<string>();
for (const [pid, v] of Object.entries(all)) if (pid !== id) for (const a of JSON.parse(v as string).funds) for (const l of a.leaves) claimedElsewhere.add(l);

let ok = true;
for (const a of p.funds) {
  const b = await (await fetch(`https://kikib.zo.space/api/papertrail/impact?batch=${a.batch_id}`)).json();
  const chain = await viewBatch(a.batch_id);
  const leaves = new Set(b.receipts.map((r: any) => leaf(r).toString("hex")));
  const mine = b.receipts.filter((r: any) => a.leaves.includes(leaf(r).toString("hex")));
  const checks: [string, boolean][] = [
    [`batch ${a.batch_id} fingerprint on NEAR matches its receipts`, !!chain && chain.merkle_root === merkleRoot(b.receipts)],
    [`all ${a.leaves.length} funded brief(s) are inside that batch`, a.leaves.every((l: string) => leaves.has(l))],
    [`each funded brief has a valid TEE signature`, mine.length === a.leaves.length && mine.every((r: any) => verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase())],
    [`no other pledge claims the same brief(s)`, a.leaves.every((l: string) => !claimedElsewhere.has(l))],
  ];
  for (const [label, pass] of checks) { console.log(`  ${pass ? "yes" : "NO "}  ${label}`); ok &&= pass; }
}
if (!p.funds.length) console.log("  waiting: no briefs matched yet");
console.log(ok && p.funds.length ? "VERIFIED" : p.funds.length ? "FAILED" : "PENDING");
