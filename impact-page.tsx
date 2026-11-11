import { useEffect, useState } from "react";
import { ShieldCheck, FileCheck2, EyeOff, Link2, HeartHandshake, X, Loader2, CheckCircle2, XCircle, Search, Circle } from "lucide-react";
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
const NEAR_AI = "https://cloud-api.near.ai/v1";
const PRICE = 1;
const AMOUNTS = [1, 3, 5];
const LANG: Record<string, string> = { es: "Spanish", en: "English", fr: "French", pt: "Portuguese", ht: "Haitian Creole", zh: "Chinese", ar: "Arabic" };
const BUCKETS: [number, string][] = [[100, "100+"], [50, "50-99"], [25, "25-49"], [10, "10-24"]];
const bucket = (n: number) => BUCKETS.find(([m]) => n >= m)?.[1] ?? "<10";

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const sha = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const cat = (a: Uint8Array, b: Uint8Array) => { const j = new Uint8Array(a.length + b.length); j.set(a); j.set(b, a.length); return j; };
const cmp = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// v3 leaf binds the brief text by hash; v2 had no brief hash; v1 (pilot) had no receipt id.
const leafOf = (r: any) => sha(enc(
  r.brief_hash ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}\n${r.brief_hash}`
    : r.rid ? `${r.rid}\n${r.text}\n${r.signature.toLowerCase()}` : `${r.text}\n${r.signature.toLowerCase()}`));

async function sortedLeaves(receipts: any[]) {
  const l = await Promise.all(receipts.map(leafOf));
  return l.sort(cmp);
}
async function merkleRoot(receipts: any[]) {
  let level = await sortedLeaves(receipts);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await sha(cat(level[i], level[i + 1])) : level[i]);
    level = next;
  }
  return level.length ? hex(level[0]) : "";
}
async function merklePath(receipts: any[], target: string) {
  let level = await sortedLeaves(receipts);
  let i = level.findIndex((b) => hex(b) === target);
  if (i < 0) return null;
  const path: { side: "L" | "R"; hash: string }[] = [];
  while (level.length > 1) {
    const sib = i % 2 ? i - 1 : i + 1;
    if (sib < level.length) path.push({ side: i % 2 ? "L" : "R", hash: hex(level[sib]) });
    const next: Uint8Array[] = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? await sha(cat(level[k], level[k + 1])) : level[k]);
    level = next; i = Math.floor(i / 2);
  }
  return path;
}
async function walk(start: string, path: { side: "L" | "R"; hash: string }[]) {
  let h = unhex(start);
  for (const s of path) h = await sha(s.side === "L" ? cat(unhex(s.hash), h) : cat(h, unhex(s.hash)));
  return hex(h);
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
  const v = (await socialGet(`batch/${id}`))?.batch?.[id];
  return v ? JSON.parse(v) : null;
}

const getJson = async (u: string) => (await fetch(u, { headers: { Accept: "application/json" } })).json();
const batchCache = new Map<string, Promise<any>>();
const getBatch = (id: string) => { if (!batchCache.has(id)) batchCache.set(id, getJson(`/api/papertrail/impact?batch=${id}`)); return batchCache.get(id)!; };
async function attested(model: string) {
  const j = await getJson(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`);
  return new Set<string>((j.model_attestations || []).map((m: any) => String(m.signing_address).toLowerCase()));
}

type Check = { label: string; ok: boolean };
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

function H({ v }: { v: string }) {
  return <code title={v} className="rounded bg-[var(--accentSoft)] px-1.5 py-0.5 font-mono text-xs text-[var(--accent)]">{v.slice(0, 12)}</code>;
}

type Step = { title: string; detail: React.ReactNode; tech?: React.ReactNode; ok: boolean | null; link?: { href: string; label: string } };

const DOC_PLAIN: [RegExp, string][] = [
  [/^Notice to Appear/, "the Notice to Appear that opens their immigration court case"],
  [/^Court hearing notice/, "their court date notice"],
  [/^Passport/, "their passport"],
  [/^Birth certificate/, "their birth certificate"],
  [/^I-94/, "their entry record"],
  [/^USCIS receipt/, "a USCIS receipt"],
  [/^Proof of time/, "proof of how long they've lived in the US"],
  [/^Family member/, "a family member's citizenship or green card"],
];
const plainDoc = (s: string) => DOC_PLAIN.find(([re]) => re.test(s))?.[1] ?? s.toLowerCase();
const list = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

// Turns a SPECIMEN brief into what the donor's money did, in plain words. Real briefs are never published, so this only runs on demo cases.
function impactOf(brief: string) {
  const ls = brief.split("\n").map((l) => l.trim());
  const have = ls.filter((l) => l.startsWith("✓ ")).map((l) => plainDoc(l.slice(2)));
  const missing = ls.filter((l) => l.startsWith("○ ")).length;
  const out: string[] = [];
  if (have.length) out.push(`Read ${list(have)} from a phone photo and typed up the key facts (name, birth date, immigration ID number) so a lawyer doesn't have to.`);
  if (ls.some((l) => l.startsWith("Charges:"))) out.push("Wrote out exactly what the government says about them, so a lawyer can start on day one.");
  for (const f of ls.filter((l) => l.startsWith("⚠ ")).map((l) => l.slice(2))) {
    let m: RegExpMatchArray | null;
    if ((m = f.match(/^Hearing (.+?)(?: at .+?)?, in (\d+) days?/))) out.push(`Caught their court date, ${m[1]}, ${m[2]} days away, and showed them how to confirm it. Missing it can mean being ordered deported.`);
    else if ((m = f.match(/^The hearing date on your notice \((.+?)\) has passed/))) out.push(`Noticed their court date (${m[1]}) had already passed and pointed them to where to find the next one.`);
    else if ((m = f.match(/^(.+?) expired (.+?)\.$/))) out.push(`Spotted that ${plainDoc(m[1])} expired on ${m[2]}.`);
    else if ((m = f.match(/^(.+?) expires soon: (.+?)\.$/))) out.push(`Warned them that ${plainDoc(m[1])} expires soon (${m[2]}).`);
    else if ((m = f.match(/^(Name|Date of birth|A-Number) doesn't match/))) out.push(`Caught a ${m[1] === "A-Number" ? "immigration ID number" : m[1].toLowerCase()} that doesn't match across two papers, a mistake that can stall a case.`);
    else if (/admit until/.test(f)) out.push("Flagged that the date on their entry record has passed.");
  }
  if (missing) out.push(`Made a checklist of the ${missing} papers still missing, so they know what to find before court.`);
  out.push("Did all of it privately: the AI read the papers inside sealed hardware and the photos were deleted.");
  return out;
}

// Follows one brief from the pledge that paid for it down to the root on NEAR. Every value is computed or fetched in this browser.
function Trace({ leaf, batchId }: { leaf: string; batchId: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [done, setDone] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [showTech, setShowTech] = useState(false);
  useEffect(() => {
    let live = true;
    setSteps([]); setDone(false); setReceipt(null); setBrief(null);
    const add = async (s: Step) => { if (!live) return; setSteps((x) => [...x, s]); await sleep(500); };
    (async () => {
      try {
        const pledges = (await socialGet("pledge/*"))?.pledge ?? {};
        const claims = Object.entries(pledges).filter(([, v]) => JSON.parse(v as string).funds.some((a: any) => a.leaves.includes(leaf))).map(([k]) => k);
        await add({ title: claims.length ? "A donor's pledge is on public record" : "No donor yet", detail: claims.length ? `Pledge ${claims[0]} is written on NEAR, a public ledger anyone can read, and it points to this one brief.` : "No pledge on NEAR points to this brief yet.", tech: <>Read live from NEAR: the pledge names brief fingerprint <H v={leaf} /></>, ok: claims.length ? true : null });
        const b = await getBatch(batchId);
        let r: any = null;
        for (const x of b.receipts) if (hex(await leafOf(x)) === leaf) { r = x; break; }
        if (!live) return;
        setReceipt(r);
        await add({ title: "The brief was really delivered", detail: "There's a public receipt for it. The receipt has no name or details, just a random number and a tamper-proof seal.", tech: <>Batch {batchId} publishes one receipt per brief: a random id, the model, two hashes, and the enclave's signature.</>, ok: !!r, link: { href: `/api/papertrail/impact?batch=${batchId}`, label: "see receipts" } });
        if (!r) return;
        if (r.brief_hash) {
          const s = await getJson(`/api/papertrail/impact?specimen=${leaf}`).catch(() => null);
          if (s?.brief) {
            const h = hex(await sha(enc(s.brief)));
            if (live) setBrief(s.brief);
            await add({ title: "Nobody changed it afterward", detail: "The demo brief matches its seal exactly. Change one letter and this check fails.", tech: <>SHA-256 of the brief text is <H v={h} />, the same brief hash sealed into the receipt.</>, ok: h === r.brief_hash });
          } else await add({ title: "The brief stays with the person", detail: "Only a seal of it is public. Whoever holds the brief can prove it's this one. Nobody else can read it.", tech: <>Brief hash <H v={r.brief_hash} /></>, ok: null });
        } else await add({ title: "Brief text not sealed", detail: "Made before briefs were sealed. The receipt still proves the papers were read privately.", ok: null });
        const signer = verifyMessage(r.text, r.signature).toLowerCase();
        await add({ title: "Read privately, in sealed hardware", detail: "An AI read the papers inside a locked chip that even Paper Trail can't look into. The photos were then deleted.", tech: <>The signature recovers to enclave key <H v={signer} />.</>, ok: signer === r.signing_address.toLowerCase() });
        const att = await attested(r.model);
        await add({ title: "The sealed hardware is the real thing", detail: "NEAR AI publicly vouches for the key that signed this brief. That key is born inside the chip and can't leave it.", tech: <>Listed in NEAR AI's live attestation report for {r.model}.</>, ok: att.has(signer), link: { href: `${NEAR_AI}/attestation/report?model=${encodeURIComponent(r.model)}&signing_algo=ecdsa`, label: "NEAR AI report" } });
        const l = hex(await leafOf(r));
        const path = await merklePath(b.receipts, leaf);
        const root = path ? await walk(leaf, path) : "";
        const chain = await chainRecord(batchId);
        await add({ title: "Locked into this week's public record", detail: `NEAR keeps one seal covering every brief in batch ${batchId}. This brief is inside it, so it can't be swapped out or added later.`, tech: <>Receipt + brief hash → fingerprint <H v={l} />. {path?.length ?? 0} hashing steps roll it up to <H v={root} />. NEAR stores <H v={chain?.merkle_root ?? "not found"} />.</>, ok: l === leaf && !!chain && chain.merkle_root === root, link: b.tx ? { href: `https://testnet.nearblocks.io/txns/${b.tx}`, label: "NEAR transaction" } : undefined });
        await add({ title: "Counted once", detail: claims.length > 1 ? `Also claimed by ${claims.slice(1).join(", ")}.` : "No other donor paid for this same brief, so nothing is double-counted.", ok: claims.length <= 1 });
      } catch {
        await add({ title: "Could not reach NEAR or the receipts", detail: "Try again in a minute.", ok: false });
      } finally { if (live) setDone(true); }
    })();
    return () => { live = false; };
  }, [leaf, batchId]);
  return (
    <div className="mt-4">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              {s.ok === true ? <CheckCircle2 className="size-5 shrink-0 text-[var(--accent)]" /> : s.ok === false ? <XCircle className="size-5 shrink-0 text-red-700" /> : <Circle className="size-5 shrink-0 text-[var(--muted)]" />}
              {i < steps.length - 1 && <div className="mt-1 w-px flex-1 bg-[var(--line)]" />}
            </div>
            <div className="pb-1 text-sm">
              <p className="font-medium">{s.title}{s.link && <a href={s.link.href} target="_blank" rel="noreferrer" className="ml-2 font-normal text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">{s.link.label}</a>}</p>
              <p className="text-[var(--muted)]">{s.detail}</p>
              {showTech && s.tech && <p className="mt-1 text-xs text-[var(--muted)]">{s.tech}</p>}
            </div>
          </li>
        ))}
      </ol>
      {!done && <p className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" />Checking…</p>}
      {done && <button onClick={() => setShowTech(!showTech)} className="mt-3 text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">{showTech ? "Hide" : "Show"} the technical details</button>}
      {done && brief && (
        <div className="mt-5">
          <button onClick={() => setShowBrief(!showBrief)} className="text-sm font-medium text-[var(--accent)] underline underline-offset-4 hover:no-underline">{showBrief ? "Hide" : "Read"} the brief itself</button>
          {showBrief && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4 font-mono text-xs">{brief}{`\n\nBRIEF FINGERPRINT\n${leaf.slice(0, 12)}`}</pre>}
          <p className="mt-1 text-xs text-[var(--muted)]">Demo brief: a made-up person and fake documents, so it's safe to show. Real briefs are never published.</p>
        </div>
      )}
      {done && showTech && receipt && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Everything the public can see about this brief</p>
          <pre className="overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4 font-mono text-xs">{JSON.stringify(receipt, null, 1)}</pre>
          <p className="mt-2 text-xs text-[var(--muted)]">No name, phone number, A-Number, birth date, court, language or exact date. The id is random. The rest are hashes and a signature.</p>
        </div>
      )}
    </div>
  );
}

function PledgeCard({ id, onClose }: { id: string; onClose: () => void }) {
  const [p, setP] = useState<any>(null);
  const [pick, setPick] = useState<{ leaf: string; batchId: string } | null>(null);
  const [briefs, setBriefs] = useState<Record<string, string | null>>({});
  useEffect(() => { getJson(`/api/papertrail/pledge?id=${id}`).then(setP).catch(() => setP({ error: true })); }, [id]);
  useEffect(() => {
    if (!p?.funds) return;
    for (const a of p.funds) for (const l of a.leaves as string[])
      getJson(`/api/papertrail/impact?specimen=${l}`).then((s) => s?.brief ?? null).catch(() => null).then((b) => setBriefs((x) => ({ ...x, [l]: b })));
  }, [p]);
  if (!p) return null;
  if (p.error) return <p className="mb-8 text-sm text-[var(--muted)]">Pledge {id} not found.</p>;
  const all = p.funds.flatMap((a: any) => a.leaves.map((l: string) => ({ leaf: l, batchId: a.batch_id })));
  return (
    <section className="mb-12 rounded-xl border-2 border-[var(--accent)] bg-[var(--card)] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">Your pledge · {p.pledge_id}</p>
          <h2 className="text-xl font-semibold">{all.length ? `Your $${p.amount_usd} helped ${all.length === 1 ? "one person" : `${all.length} people`} get their papers ready for immigration court` : `Your $${p.amount_usd} is waiting for the next brief`}</h2>
          {all.length > 0 && all.length < p.briefs && <p className="mt-1 text-sm text-[var(--muted)]">{p.briefs - all.length} more will be matched when the next batch is published.</p>}
        </div>
        <button onClick={onClose} aria-label="Close"><X className="size-5 text-[var(--muted)]" /></button>
      </div>
      {all.length ? (
        <>
          <div className="space-y-4">
            {all.map((x: any, i: number) => {
              const loaded = x.leaf in briefs;
              const b = briefs[x.leaf];
              const open = pick?.leaf === x.leaf;
              return (
                <div key={x.leaf} className="rounded-lg bg-[var(--accentSoft)] p-4">
                  {all.length > 1 && <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Person {i + 1}</p>}
                  {!loaded ? <p className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" />Loading…</p> : b ? (
                    <>
                      <p className="mb-2 text-sm">Someone facing immigration court sent photos of their papers over WhatsApp. Your money paid for Paper Trail to:</p>
                      <ul className="list-disc space-y-1 pl-5 text-sm">{impactOf(b).map((t) => <li key={t}>{t}</li>)}</ul>
                      <p className="mt-2 text-sm">They got back a one-page brief they can hand to a lawyer.</p>
                      <p className="mt-2 text-xs text-[var(--muted)]">Demo case: a made-up person with fake documents, so we can show you what it did. For a real person you'd see the proof below, never their details.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">Someone facing immigration court sent photos of their papers over WhatsApp. Your money paid for Paper Trail to read them privately, flag anything urgent like a court date or an expired ID, and hand back a one-page brief they can give a lawyer.</p>
                      <p className="mt-2 text-xs text-[var(--muted)]">What it said stays private. You'll never learn who it helped, and they'll never learn who you are.</p>
                    </>
                  )}
                  <button onClick={() => setPick(open ? null : x)} className="mt-3 text-sm font-medium text-[var(--accent)] underline underline-offset-4 hover:no-underline">{open ? "Hide the proof" : "How do I know this really happened?"}</button>
                  {open && <Trace key={x.leaf} leaf={x.leaf} batchId={x.batchId} />}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mb-4 text-sm text-[var(--muted)]">Every delivered brief already has a sponsor. Yours will be matched when the next verified batch is published.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--line)] pt-3">
        {p.tx.map((t: any, i: number) => (
          <a key={t.tx} href={t.explorer} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">{i ? "Update" : "Pledge"} transaction</a>
        ))}
      </div>
    </section>
  );
}

function Lookup() {
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<{ leaf: string; batchId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const find = async () => {
    const k = q.trim().toLowerCase();
    setHit(null); setMsg("");
    if (!/^[0-9a-f]{8,64}$/.test(k)) { setMsg("Enter the 12-character fingerprint at the end of a brief."); return; }
    setBusy(true);
    try {
      const idx = await getJson("/api/papertrail/impact");
      for (const b of idx.batches.filter((x: any) => x.v >= 2)) {
        const bb = await getBatch(b.id);
        for (const r of bb.receipts) {
          const l = hex(await leafOf(r));
          if (l.startsWith(k)) { setHit({ leaf: l, batchId: b.id }); setBusy(false); return; }
        }
      }
      setMsg("Not in a published batch yet. Batches publish weekly, once 10 or more briefs are ready.");
    } catch { setMsg("Couldn't reach the receipts. Try again."); }
    setBusy(false);
  };
  return (
    <section className="mb-12 rounded-xl border border-[var(--line)] bg-[var(--card)] p-5">
      <h2 className="mb-1 text-xl font-semibold">Check a brief</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">Every brief ends with a fingerprint. Whoever holds the brief (the person or their lawyer) can enter it here to see that it was made in sealed hardware, is on NEAR, and whether a donor sponsored it. Nobody learns who it belongs to.</p>
      <form onSubmit={(e) => { e.preventDefault(); find(); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. d46a1941cf0a" className="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 font-mono text-sm" />
        <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent)] disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Check
        </button>
      </form>
      {msg && <p className="mt-3 text-sm text-[var(--muted)]">{msg}</p>}
      {hit && <Trace key={hit.leaf} leaf={hit.leaf} batchId={hit.batchId} />}
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
      const b = await getBatch(id);
      const sigs = b.receipts.every((r: any) => verifyMessage(r.text, r.signature).toLowerCase() === r.signing_address.toLowerCase());
      out.push({ label: `${b.receipts.length} TEE signatures valid`, ok: sigs });
      const root = await merkleRoot(b.receipts);
      const chain = await chainRecord(id);
      out.push({ label: "Fingerprint found on NEAR", ok: !!chain });
      out.push({ label: "Fingerprint matches the receipts", ok: !!chain && (chain.merkle_root ?? chain.root) === root && (chain.v >= 2 ? chain.count_bucket === bucket(b.receipts.length) : chain.briefs === b.receipts.length) });
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
  const [amt, setAmt] = useState(AMOUNTS[0]);
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
        <p className="mb-4 text-sm text-[var(--muted)]">You pay only for work that's already proven. Each ${PRICE} is matched to one brief that was delivered and signed inside sealed hardware. You'll get a pledge code that leads to the exact brief you paid for, on NEAR. You'll never learn who it helped.</p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {AMOUNTS.map((a) => (
            <button key={a} onClick={() => setAmt(a)} className={`rounded-lg border py-3 font-medium ${amt === a ? "border-[var(--accent)] bg-[var(--accentSoft)] text-[var(--accent)]" : "border-[var(--line)]"}`}>
              ${a}<span className="block text-xs font-normal text-[var(--muted)]">{a / PRICE} brief{a > PRICE ? "s" : ""}</span>
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
    getJson("/api/papertrail/impact").then(setData).catch(() => setData({ error: true }));
  }, []);
  const t = data?.totals;
  return (
    <main
      style={{ "--bg": theme.bg, "--fg": theme.fg, "--card": theme.card, "--muted": theme.muted, "--line": theme.line, "--accent": theme.accent, "--accentSoft": theme.accentSoft } as React.CSSProperties}
      className="min-h-screen bg-[var(--bg)] px-5 py-12 text-[var(--fg)]"
    >
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--accent)]">Paper Trail · Impact</p>
        <h1 className="mb-4 text-4xl font-semibold text-balance">Donors get proof of impact. Immigrants don't get watched.</h1>
        <p className="mb-8 max-w-2xl text-lg text-[var(--muted)]">
          Paper Trail turns an immigrant family's papers into a lawyer-ready brief over WhatsApp. Sealed hardware (a TEE) signs every brief, and only an anonymous fingerprint goes on the NEAR blockchain. Sponsor one, and you can follow your pledge to the exact brief it paid for, without ever learning whose it is.
        </p>
        <div className="mb-12 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button onClick={() => setSponsor(true)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white hover:opacity-90">
            <HeartHandshake className="size-5" />Sponsor a case
          </button>
          {stats && <p className="text-sm text-[var(--muted)]">{stats.briefs_funded} of {stats.briefs_verified} verified briefs sponsored on testnet</p>}
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

        <Lookup />

        <h2 className="mb-4 text-xl font-semibold">Batches</h2>
        {data?.error && <p className="text-[var(--muted)]">Couldn't load batches.</p>}
        {data?.batches?.length === 0 && <p className="text-[var(--muted)]">No batches yet.</p>}
        <div className="mb-12 space-y-4">
          {data?.batches?.slice().reverse().map((b: any) => (
            <article key={b.id} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{b.v >= 2 ? `Batch ${b.id}` : `Pilot batch ${b.id}`} · {b.count_bucket} briefs</h3>
                <span className="text-sm text-[var(--muted)]">{b.week_of ? `week of ${b.week_of}` : `week ${b.period}`}</span>
              </div>
              <p className="mb-1 break-all font-mono text-xs text-[var(--muted)]">fingerprint {b.merkle_root ?? b.root}</p>
              <p className="mb-4 font-mono text-xs text-[var(--muted)]">signed in TEE by {b.models.join(", ")}{b.v >= 3 ? " · brief text sealed by hash" : ""}</p>
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
            <p className="text-[var(--muted)]">A TEE-verified brief was delivered. The enclave signs a receipt with a key that never leaves the hardware, and the brief's text is sealed into that receipt by hash. The fingerprint on NEAR can't be changed after the fact. Each sponsorship names specific briefs, and no brief can be claimed by two sponsors.</p>
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
