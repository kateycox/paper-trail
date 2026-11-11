// Anyone can run this: follows a sponsorship pledge to the exact briefs it paid for, one link at a time,
// using only NEAR testnet, NEAR AI's public attestation report and the public receipts.
// Usage: bun verify-pledge.ts PT-XXXXXXXX
import { createHash } from "node:crypto";
import { verifyMessage } from "ethers";
import { socialGet, leaf, merkleProof, walkProof, viewBatch, NEAR_AI } from "./lib";

const SITE = "https://kikib.zo.space/api/papertrail/impact";
const id = process.argv[2];
const raw = (await socialGet(`pledge/${id}`))?.pledge?.[id];
if (!raw) { console.log(`pledge ${id}: not found on NEAR`); process.exit(1); }
const p = JSON.parse(raw);
console.log(`pledge ${id} (read from NEAR): $${p.amount_usd} for ${p.briefs} brief(s), ${p.status}`);

const all = (await socialGet("pledge/*"))?.pledge ?? {};
const claimedElsewhere = new Set<string>();
for (const [pid, v] of Object.entries(all)) if (pid !== id) for (const a of JSON.parse(v as string).funds) for (const l of a.leaves) claimedElsewhere.add(l);

const attested = new Map<string, Set<string>>();
const signersFor = async (model: string) => {
  if (!attested.has(model)) {
    const j: any = await (await fetch(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`)).json();
    attested.set(model, new Set((j.model_attestations || []).map((m: any) => String(m.signing_address).toLowerCase())));
  }
  return attested.get(model)!;
};

let ok = true;
const say = (pass: boolean, label: string) => { console.log(`    ${pass ? "yes" : "NO "}  ${label}`); ok &&= pass; };
for (const a of p.funds) {
  const b = await (await fetch(`${SITE}?batch=${a.batch_id}`)).json();
  const chain = await viewBatch(a.batch_id);
  for (const l of a.leaves) {
    console.log(`\n  brief ${l}`);
    const r = b.receipts.find((x: any) => leaf(x).toString("hex") === l);
    say(!!r, `its receipt is in batch ${a.batch_id}'s public receipts, and hashes to this fingerprint`);
    if (!r) continue;
    const spec = r.brief_hash ? await (await fetch(`${SITE}?specimen=${l}`)).json() : null;
    if (spec?.brief) say(createHash("sha256").update(spec.brief).digest("hex") === r.brief_hash, `SPECIMEN brief text published for the demo hashes to brief_hash ${r.brief_hash.slice(0, 12)}…`);
    else console.log(`    --   ${r.brief_hash ? "brief text stays with the person; only its hash is public" : "v2 receipt, made before brief hashing"}`);
    const signer = verifyMessage(r.text, r.signature).toLowerCase();
    say(signer === r.signing_address.toLowerCase(), `TEE signature recovers to ${signer}`);
    say((await signersFor(r.model)).has(signer), `that key is in NEAR AI's live attestation report for ${r.model}`);
    const path = merkleProof(b.receipts, l)!;
    const root = walkProof(l, path);
    say(!!chain && chain.merkle_root === root, `${path.length} Merkle steps lead to ${root.slice(0, 12)}…, the root stored on NEAR for ${a.batch_id}`);
    say(!claimedElsewhere.has(l), "no other pledge on NEAR claims this brief");
  }
}
if (!p.funds.length) console.log("  waiting: no briefs matched yet");
console.log(ok && p.funds.length ? "\nVERIFIED" : p.funds.length ? "\nFAILED" : "\nPENDING");
