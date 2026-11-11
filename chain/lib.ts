import { createHash } from "node:crypto";

export const ACCOUNT = "papertrail-impact.testnet";
export const SOCIAL = "v1.social08.testnet";
export const RPC = "https://rpc.testnet.near.org";
export const NEAR_AI = "https://cloud-api.near.ai/v1";

export type Receipt = { rid?: string; model: string; text: string; signature: string; signing_address: string; brief_hash?: string };

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
// v3 leaf = SHA-256(receipt_id, signed text "model:request_hash:response_hash", TEE signature, SHA-256 of the brief text).
// v2 had no brief hash; v1 (pilot batch b1) had no receipt_id either.
export const leaf = (r: Receipt) =>
  sha(r.brief_hash ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}\n${r.brief_hash}`
    : r.rid ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}` : `${r.text}\n${r.signature.toLowerCase()}`);

export const MIN_BATCH = 10;
export const bucket = (n: number) => (n >= 100 ? "100+" : n >= 50 ? "50-99" : n >= 25 ? "25-49" : n >= 10 ? "10-24" : "<10");

// Inclusion proof for one leaf: sibling hashes from the bottom up. side "L" = sibling goes on the left.
export function merkleProof(receipts: Receipt[], target: string): { side: "L" | "R"; hash: string }[] | null {
  let level = receipts.map(leaf).sort(Buffer.compare);
  let i = level.findIndex((b) => b.toString("hex") === target);
  if (i < 0) return null;
  const path: { side: "L" | "R"; hash: string }[] = [];
  while (level.length > 1) {
    const sib = i % 2 ? i - 1 : i + 1;
    if (sib < level.length) path.push({ side: i % 2 ? "L" : "R", hash: level[sib].toString("hex") });
    const next: Buffer[] = [];
    for (let k = 0; k < level.length; k += 2)
      next.push(k + 1 < level.length ? sha(Buffer.concat([level[k], level[k + 1]])) : level[k]);
    level = next; i = Math.floor(i / 2);
  }
  return path;
}
export const walkProof = (start: string, path: { side: "L" | "R"; hash: string }[]) =>
  path.reduce((h, s) => sha(Buffer.concat(s.side === "L" ? [Buffer.from(s.hash, "hex"), h] : [h, Buffer.from(s.hash, "hex")])), Buffer.from(start, "hex")).toString("hex");

export function merkleRoot(receipts: Receipt[]): string {
  let level = receipts.map(leaf).sort(Buffer.compare);
  if (!level.length) return "";
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? sha(Buffer.concat([level[i], level[i + 1]])) : level[i]);
    level = next;
  }
  return level[0].toString("hex");
}

export async function viewBatch(id: string): Promise<any | null> {
  const args = Buffer.from(JSON.stringify({ keys: [`${ACCOUNT}/papertrail/batch/${id}`] })).toString("base64");
  const r: any = await (await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: SOCIAL, method_name: "get", args_base64: args } }),
  })).json();
  if (!r.result) return null;
  const v = JSON.parse(Buffer.from(r.result.result).toString())?.[ACCOUNT]?.papertrail?.batch?.[id];
  return v ? JSON.parse(v) : null;
}

export async function attestedSigners(model: string, key: string): Promise<Set<string>> {
  const r = await fetch(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json();
  const out = new Set<string>();
  for (const m of j.model_attestations || []) if (m.signing_address) out.add(String(m.signing_address).toLowerCase());
  return out;
}

export async function socialGet(key: string): Promise<any> {
  const args = Buffer.from(JSON.stringify({ keys: [`${ACCOUNT}/papertrail/${key}`] })).toString("base64");
  const r: any = await (await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: SOCIAL, method_name: "get", args_base64: args } }),
  })).json();
  return r.result ? JSON.parse(Buffer.from(r.result.result).toString())?.[ACCOUNT]?.papertrail ?? null : null;
}
