import { createHash } from "node:crypto";

export const ACCOUNT = "papertrail-impact.testnet";
export const SOCIAL = "v1.social08.testnet";
export const RPC = "https://rpc.testnet.near.org";
export const NEAR_AI = "https://cloud-api.near.ai/v1";

export type Receipt = { rid?: string; model: string; text: string; signature: string; signing_address: string };

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
// v2 leaf = SHA-256(receipt_id, signed text "model:request_hash:response_hash", TEE signature). v1 (batch b1) had no receipt_id.
export const leaf = (r: Receipt) =>
  sha(r.rid ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}` : `${r.text}\n${r.signature.toLowerCase()}`);

export const MIN_BATCH = 10;
export const bucket = (n: number) => (n >= 100 ? "100+" : n >= 50 ? "50-99" : n >= 25 ? "25-49" : n >= 10 ? "10-24" : "<10");

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
