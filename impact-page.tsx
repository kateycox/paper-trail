import { useEffect, useState } from "react";
import { ShieldCheck, FileCheck2, EyeOff, Link2, HeartHandshake, X, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { verifyMessage } from "https://esm.sh/ethers@6.13.4";

const theme = {
  bg: "#f7f5f0",
  fg: "#1c1b18",
  card: "#ffffff",
  muted: "#6b665c",
  line: "#e4dfd4",
  accent: "#2f5d50",
  accentSoft: "#e3eee9",
};

const RPC = "https://rpc.testnet.near.org";
const SOCIAL = "v1.social08.testnet";
const ACCOUNT = "papertrail-impact.testnet";
const LANG: Record<string, string> = { es: "Spanish", en: "English", fr: "French", pt: "Portuguese", ht: "Haitian Creole", zh: "Chinese", ar: "Arabic" };
const BUCKETS: [number, string][] = [[100, "100+"], [50, "50-99"], [25, "25-49"], [10, "10-24"]];
const bucket = (n: number) => BUCKETS.find(([m]) => n >= m)?.[1] ?? "<10";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const cmp = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

const leafOf = (r: any) => sha(new TextEncoder().encode(r.rid ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}` : `${r.text}\n${r.signature.toLowerCase()}`));

async function merkleRoot(receipts: any[]) {
  let level = await Promise.all(receipts.map(leafOf));
  level.sort(cmp);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) { const j = new Uint8Array(64); j.set(level[i]); j.set(level[i + 1], 32); next.push(await sha(j)); }
      else next.push(level[i]);
    }
    level = next;
  }
  return level.length ? hex(level[0].buffer) : "";
}

async function socialGet(key: string) {
  const args = btoa(JSON.stringify({ keys: [`${ACCOUNT}/papertrail/${key}`] }));
  const r = await (await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: SOCIAL, method_name: "get", args_base64: args } }),
  })).json();
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)))?.[ACCOUNT]?.papertrail ?? null;
}

async function chainRecord(id: string) {
  const args = btoa(JSON.stringify({ keys: [`${ACCOUNT}/papertrail/batch/${id}`] }));
  const r = await (await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: SOCIAL, method_name: "get", args_base64: args } }),
  })).json();
  const raw = new TextDecoder().decode(new Uint8Array(r.result.result));
  const v = JSON.parse(raw)?.[ACCOUNT]?.papertrail?.batch?.[id];
  return v ? JSON.parse(v) : null;
}

type Check = { label: string; ok: boolean };
const getJson = async (u: string) => (await fetch(u, { headers: { Accept: "application/json" } })).json();

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.label} className="flex items-center gap-2">
          {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-[var(--accent)]" /> : <XCircle className="size-4 shrink-0 text-red-700" />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}

async function verifyPledge(id: string): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const all = (await socialGet("pledge/*"))?.pledge ?? {};
    const raw = all[id];
    out.push({ label: "Pledge found on NEAR", ok: !!raw });
    if (!raw) return out;
    const p = JSON.parse(raw);
    const elsewhere = new Set<string>();
    for (const [pid, v] of Object.entries(all)) if (pid !== id) for (const a of JSON.parse(v as string).funds) for (const l of a.leaves) elsewhere.add(l);
    for (const a of p.funds) {
      const b = await getJson(`/api/papertrail/impact?batch=${a.batch_id}`);
      const chain = await chainRecord(a.batch_id);
      const leaves = await Promise.all(b.receipts.map(async (r: any) => hex((await leafOf(r)).buffer)));
      const mine = b.receipts.filter((_: any, i: number) => a.leaves.includes(leaves[i]));
      out.push({ label: `Batch ${a.batch_id} fingerprint on NEAR matches its receipts`, ok: !!chain && chain.merkle_root === (await merkleRoot(b.receipts)) });
      out.push({ label: `Your ${a.leaves.length} brief${a.leaves.length > 1 ? "s are" : " is"} inside that batch`, ok: a.leaves.every((l: string) => leaves.includes(l)) });
      out.push({ label: "Each one carries a valid TEE signature", ok: mine.length === a.leaves.length && mine.every((r: any) => verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase()) });
      out.push({ label: "No other sponsor claims the same briefs", ok: a.leaves.every((l: string) => !elsewhere.has(l)) });
    }
  } catch {
    out.push({ label: "Could not reach NEAR or the receipts", ok: false });
  }
  return out;
}

function PledgeCard({ id, onClose }: { id: string; onClose: () => void }) {
  const [p, setP] = useState<any>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getJson(`/api/papertrail/pledge?id=${id}`).then(setP).catch(() => setP({ error: true })); }, [id]);
  if (!p) return null;
  if (p.error) return <p className="mb-8 text-sm text-[var(--muted)]">Pledge {id} not found.</p>;
  const n = p.funds.reduce((k: number, a: any) => k + a.leaves.length, 0);
  return (
    <section className="mb-12 rounded-xl border-2 border-[var(--accent)] bg-[var(--card)] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">Your pledge · {p.pledge_id}</p>
          <h2 className="text-xl font-semibold">${p.amount_usd} → {n} of {p.briefs} brief{p.briefs > 1 ? "s" : ""} funded</h2>
        </div>
        <button onClick={onClose} aria-label="Close"><X className="size-5 text-[var(--muted)]" /></button>
      </div>
      {p.funds.length ? (
        <div className="mb-4 space-y-2 text-sm">
          {p.funds.map((a: any) => (
            <div key={a.batch_id}>
              <p>Paid for {a.leaves.length} TEE-signed brief{a.leaves.length > 1 ? "s" : ""} in batch <span className="font-medium">{a.batch_id}</span>:</p>
              {a.leaves.map((l: string) => <p key={l} className="break-all font-mono text-xs text-[var(--muted)]">brief {l}</p>)}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-sm text-[var(--muted)]">Every delivered brief already has a sponsor. Yours will be matched when the next verified batch is published.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {checks ? <CheckList checks={checks} /> : busy ? (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" />Checking NEAR testnet…</span>
        ) : (
          <button onClick={async () => { setBusy(true); setChecks(await verifyPledge(id)); setBusy(false); }} className="text-sm font-medium text-[var(--accent)] underline underline-offset-4 hover:no-underline">Trace my pledge on NEAR</button>
        )}
        {p.tx.map((t: any, i: number) => (
          <a key={t.tx} href={t.explorer} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">{i ? "Update" : "Pledge"} transaction</a>
        ))}
      </div>
    </section>
  );
}

function Verify({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [checks, setChecks] = useState<Check[]>([]);
  const run = async () => {
    setState("busy");
    const out: Check[] = [];
    try {
      const b = await (await fetch(`/api/papertrail/impact?batch=${id}`, { headers: { Accept: "application/json" } })).json();
      const sigs = b.receipts.every((r: any) => verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase());
      out.push({ label: `${b.receipts.length} TEE signatures valid`, ok: sigs });
      const root = await merkleRoot(b.receipts);
      const chain = await chainRecord(id);
      out.push({ label: "Fingerprint found on NEAR", ok: !!chain });
      out.push({ label: "Fingerprint matches the receipts", ok: !!chain && (chain.merkle_root ?? chain.root) === root && (chain.v === 2 ? chain.count_bucket === bucket(b.receipts.length) : chain.briefs === b.receipts.length) });
    } catch {
      out.push({ label: "Could not reach NEAR or the receipts", ok: false });
    }
    setChecks(out);
    setState("done");
  };
  if (state === "idle") return <button onClick={run} className="text-sm font-medium text-[var(--accent)] underline underline-offset-4 hover:no-underline">Verify in this browser</button>;
  if (state === "busy") return <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" />Checking NEAR testnet…</span>;
  return <CheckList checks={checks} />;
}

function Sponsor({ onClose, onPledged }: { onClose: () => void; onPledged: (id: string) => void }) {
  const [amt, setAmt] = useState(25);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [err, setErr] = useState("");
  const pledge = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/papertrail/pledge", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ amount: amt }) });
      const j = await r.json();
      if (!r.ok || !j.pledge_id) throw new Error(j.error || "Pledge failed");
      onPledged(j.pledge_id);
    } catch (e: any) { setErr(String(e.message || e)); setState("error"); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--card)] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold">Sponsor a case</h2>
          <button onClick={onClose} aria-label="Close"><X className="size-5 text-[var(--muted)]" /></button>
        </div>
        <p className="mb-4 text-sm text-[var(--muted)]">You pay only for work that's already proven. Each $25 is matched to one brief that was delivered and signed inside sealed hardware. You'll get a pledge code to trace exactly which briefs you paid for, on NEAR. You'll never learn who they helped.</p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {[25, 50, 100].map((a) => (
            <button key={a} onClick={() => setAmt(a)} className={`rounded-lg border py-3 font-medium ${amt === a ? "border-[var(--accent)] bg-[var(--accentSoft)] text-[var(--accent)]" : "border-[var(--line)]"}`}>
              ${a}<span className="block text-xs font-normal text-[var(--muted)]">{a / 25} brief{a > 25 ? "s" : ""}</span>
            </button>
          ))}
        </div>
        <button disabled={state === "busy"} onClick={pledge} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-3 font-medium text-white hover:opacity-90 disabled:opacity-60">
          {state === "busy" ? <><Loader2 className="size-4 animate-spin" />Writing your pledge to NEAR…</> : "Pledge anonymously"}
        </button>
        {state === "error" && <p className="mt-3 text-center text-sm text-red-700">{err}</p>}
        <p className="mt-3 text-center text-xs text-[var(--muted)]">Hackathon demo on NEAR testnet. Your pledge is real and public, but no money moves. No name, email or wallet is asked for.</p>
      </div>
    </div>
  );
}

export default function PaperTrailImpact() {
  const [data, setData] = useState<any>(null);
  const [sponsor, setSponsor] = useState(false);
  const [pledgeId, setPledgeId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pledge")));
  const [stats, setStats] = useState<any>(null);
  const loadStats = () => getJson("/api/papertrail/pledge").then(setStats).catch(() => {});
  const showPledge = (id: string | null) => {
    setPledgeId(id);
    const u = new URL(window.location.href);
    id ? u.searchParams.set("pledge", id) : u.searchParams.delete("pledge");
    window.history.replaceState(null, "", u);
  };
  useEffect(() => { loadStats(); }, []);
  useEffect(() => {
    fetch("/api/papertrail/impact", { headers: { Accept: "application/json" } }).then((r) => r.json()).then(setData).catch(() => setData({ error: true }));
  }, []);
  const t = data?.totals;
  return (
    <main
      style={{ "--bg": theme.bg, "--fg": theme.fg, "--card": theme.card, "--muted": theme.muted, "--line": theme.line, "--accent": theme.accent, "--accentSoft": theme.accentSoft } as React.CSSProperties}
      className="min-h-screen bg-[var(--bg)] px-5 py-12 text-[var(--fg)]"
    >
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--accent)]">Paper Trail · Impact</p>
        <h1 className="mb-4 text-4xl font-semibold text-balance">Proof of help, without watching anyone.</h1>
        <p className="mb-8 max-w-2xl text-lg text-[var(--muted)]">
          Paper Trail turns an immigrant family's papers into a lawyer-ready brief over WhatsApp. Every brief is produced inside sealed hardware (a TEE) that signs a receipt. Each week, those receipts become one fingerprint on the NEAR blockchain. You can check the count. You can't see the people.
        </p>
        <div className="mb-12 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button onClick={() => setSponsor(true)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white hover:opacity-90">
            <HeartHandshake className="size-5" />Sponsor a case
          </button>
          {stats && <p className="text-sm text-[var(--muted)]">{stats.briefs_funded} of {stats.briefs_verified} verified briefs sponsored · ${stats.usd_pledged} pledged on testnet</p>}
        </div>
        {pledgeId && <PledgeCard key={pledgeId} id={pledgeId} onClose={() => showPledge(null)} />}

        <section className="mb-12 grid gap-4 sm:grid-cols-3">
          {[
            { icon: FileCheck2, n: t?.briefs ?? "–", l: "briefs delivered" },
            t?.langShare
              ? { icon: EyeOff, n: Object.keys(t.langShare).length, l: Object.entries(t.langShare).map(([k, v]) => `${v}% ${LANG[k] || k}`).join(", ") }
              : { icon: EyeOff, n: 0, l: "names, case details or places on the ledger" },
            { icon: Link2, n: t?.batches ?? "–", l: "batches on NEAR" },
          ].map(({ icon: I, n, l }) => (
            <div key={l} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5">
              <I className="mb-3 size-5 text-[var(--accent)]" />
              <div className="text-3xl font-semibold tabular-nums">{n}</div>
              <div className="text-sm text-[var(--muted)]">{l}</div>
            </div>
          ))}
        </section>

        <h2 className="mb-4 text-xl font-semibold">Batches</h2>
        {data?.error && <p className="text-[var(--muted)]">Couldn't load batches.</p>}
        {data?.batches?.length === 0 && <p className="text-[var(--muted)]">No batches yet.</p>}
        <div className="mb-12 space-y-4">
          {data?.batches?.slice().reverse().map((b: any) => (
            <article key={b.id} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{b.v === 2 ? `Batch ${b.id}` : `Pilot batch ${b.id}`} · {b.count_bucket} briefs</h3>
                <span className="text-sm text-[var(--muted)]">{b.week_of ? `week of ${b.week_of}` : `week ${b.period}`}</span>
              </div>
              <p className="mb-1 break-all font-mono text-xs text-[var(--muted)]">fingerprint {b.merkle_root ?? b.root}</p>
              <p className="mb-4 font-mono text-xs text-[var(--muted)]">signed in TEE by {b.models.join(", ")}</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Verify id={b.id} />
                <a href={b.explorer} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">NEAR transaction</a>
                <a href={b.download} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">Receipts (JSON)</a>
              </div>
            </article>
          ))}
        </div>

        <section className="grid gap-6 border-t border-[var(--line)] pt-8 text-sm sm:grid-cols-2">
          <div>
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-[var(--accent)]" />What this proves</h2>
            <p className="text-[var(--muted)]">A TEE-verified brief was delivered. Each counted brief was written by a model running in sealed hardware, which signed it with a key that never leaves the enclave. The fingerprint on NEAR can't be changed after the fact. Each sponsorship is tied to specific signed briefs, and no brief can be claimed by two sponsors.</p>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">What it doesn't</h2>
            <p className="text-[var(--muted)]">It doesn't prove a case was won or that anyone was helped in a larger sense. No identities go on-chain. Batches need 10+ briefs, publish 2+ days later, show a count range and the week only, because exact dates and small numbers could point to a family.</p>
          </div>
        </section>
        <p className="mt-10 border-t border-[var(--line)] pt-6 text-center text-sm font-medium">Paper Trail never asks users for money, crypto, or a wallet.</p>
      </div>
      {sponsor && <Sponsor onClose={() => setSponsor(false)} onPledged={(id) => { setSponsor(false); showPledge(id); loadStats(); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
    </main>
  );
}
