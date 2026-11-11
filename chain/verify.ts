// Anyone can run this: checks a published batch against NEAR testnet and each TEE signature.
// Usage: bun verify.ts <batch-file.json | https://kikib.zo.space/api/papertrail/impact?batch=b1>
import { readFileSync } from "node:fs";
import { verifyMessage } from "ethers";
import { merkleRoot, viewBatch, bucket } from "./lib";

const src = process.argv[2];
const b = src.startsWith("http") ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, "utf8"));
const chain = await viewBatch(b.id);
const sigOk = b.receipts.every((r: any) => verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase());
const root = merkleRoot(b.receipts);
console.log(`batch ${b.id}: ${b.receipts.length} receipts`);
console.log(`  every TEE signature valid:   ${sigOk ? "yes" : "NO"}`);
console.log(`  signers in batch record:     ${b.receipts.every((r: any) => chain?.signers?.includes(r.signing_address.toLowerCase())) ? "yes" : "NO"}`);
console.log(`  root recomputed:             ${root}`);
const chainRoot = chain?.merkle_root ?? chain?.root;
const countOk = chain?.v >= 2 ? chain.count_bucket === bucket(b.receipts.length) : chain?.briefs === b.receipts.length;
console.log(`  root on NEAR (SocialDB):     ${chainRoot ?? "not found"}`);
console.log(`  count matches NEAR record:   ${countOk ? "yes" : "NO"}${chain?.count_bucket ? ` (${chain.count_bucket})` : ""}`);
console.log(sigOk && chainRoot === root && countOk ? "VERIFIED" : "FAILED");
console.log(`  To confirm the signer is a real TEE key, compare it with NEAR AI's attestation report for ${[...new Set(b.receipts.map((r: any) => r.model))].join(", ")}.`);
