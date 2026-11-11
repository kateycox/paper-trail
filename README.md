# Paper Trail

For immigrants, Paper Trail makes papers lawyer-ready, privately. Built at NEAR HACKATHON (Nov 1–14, 2026), Privacy & Private AI and Open Innovation tracks.

## How it works

WhatsApp (Twilio Sandbox) → `https://kikib.zo.space/api/papertrail` (one zo.space API route) → NEAR AI Cloud Confidential TEE model → reply on WhatsApp.

- Photos go only to a TEE model (`Qwen/Qwen3-VL-30B-A3B-Instruct`, fallback `z-ai/glm-5.3-flash`). No non-TEE model ever sees a document.
- Built for people in immigration court. Checklist: Notice to Appear, hearing notice, passport/ID, birth certificate, I-94/entry record, USCIS receipts, proof of time in the US, family member's status.
- From each photo it pulls intake facts a lawyer needs: name as spelled, DOB, A-Number, expiration/issue dates, hearing date and court, NTA charges and allegations, receipt numbers, entry date.
- Flags computed in code (not by the model): expired or expiring within 6 months, passed I-94 "admit until" date, name / DOB / A-Number mismatches across documents, upcoming or missed hearing (points to EOIR 1-800-898-7180 / acis.eoir.justice.gov).
- **Save filter:** free text is checked (keyword list + TEE model) before anything is stored. Arrests, police contact, manner of entry, false documents, other people's status, or a lawyer's legal opinion are never saved; the user is told so. Police/criminal records sent as photos are read and dropped.
- **Storage:** `data/cases.enc.json`, one AES-256-GCM blob per user, keyed by an HMAC of the phone number. No photos stored. The key lives on the same server, so this protects against leaked files and backups, not against the operator.
- **Twilio logs:** every inbound message and its media are deleted right after processing; outbound messages are deleted 3 and 20 minutes after sending (timers are lost if the server restarts).
- Commands: `LIST`, `BRIEF` (forwardable English case brief for a lawyer), `VISIT` (logs a legal aid visit: office, date, next steps only), `COURT`, `SCAM` (fixed warning signs of immigration scams: Paper Trail never asks for money, notarios can't give legal help, how to check EOIR's accredited and disciplined lists, where to report), `PROOF` (TEE signature receipt), `DELETE`, `ESPAÑOL`/`ENGLISH`. Spanish equivalents work too.
- Replies are translated by the TEE model; if a translation changes any number, the English original is sent instead.
- Organizes papers only. Never gives legal advice.

## How NEAR is used

1. **NEAR AI Cloud (private inference).** Every document photo and every save-filter check runs on a NEAR AI Confidential TEE model. `PROOF` fetches the enclave's ECDSA signature for the user's last request (`/v1/signature/{chat_id}`), so the user or a lawyer can check it against NEAR AI's public attestation report.
2. **NEAR testnet (Proof of Impact).** Paper Trail's own account (`papertrail-impact.testnet`) writes one fingerprint per batch of briefs to SocialDB (`v1.social08.testnet`). Users never touch crypto: no wallet, no token, no signing on their side. See the next section.

## Proof of Impact

Donors get proof of impact. Immigrants don't get watched.

1. A user texts `BRIEF`. The TEE model's signature for that brief is fetched from NEAR AI Cloud.
2. Paper Trail draws a random `receipt_id` and makes a leaf: `SHA-256(receipt_id, "model:request_hash:response_hash", tee_signature)`. The receipt goes to `data/receipts.jsonl` (no names, numbers or document text). The `receipt_id` and leaf are also stored in that user's encrypted record and nowhere else that ties them to a person.
3. `chain/anchor.ts` checks every signature against NEAR AI's attested enclave keys, builds a Merkle tree, and writes one record to SocialDB under `papertrail-impact.testnet/papertrail/batch/<batch_id>`:
   `{ v: 2, batch_id: "2026-W46-01", merkle_root, count_bucket: "10-24", week_of: "2026-11-09", models, signers }` (`signers` are the enclave keys, shared by every user).
4. The receipts for a batch are published at `/api/papertrail/impact?batch=<id>`, so anyone can recompute the root (`chain/verify.ts`, or "Verify in this browser" on the impact page).
5. `PROOF` on WhatsApp tells the user which batch their brief is in, and that this shows nothing about them. After `DELETE`, their `receipt_id` is gone and their leaf can't be linked to anyone, including by the operator.

Re-identification guardrails (a small clinic serving three people a week could be found by exact dates):

- At least 10 briefs per batch. Fewer roll into the next run.
- Published no sooner than 48 hours after the newest brief. (`--now` skips the delay for the hackathon demo only; the 10-brief minimum still applies.)
- Count ranges on-chain (`10-24`, `25-49`, `50-99`, `100+`), week-level dates only.
- No per-language, per-court or per-document-type data on-chain. The page shows language shares only once the all-time total is above 100.
- Runs weekly (Mondays 6am ET, Zo automation).
- Without a signing key (`near_impact_key` or `~/.near-credentials`), the writer runs dry and logs the record it would write to `data/impact/dryrun.log`.

What it proves: a TEE-verified brief was delivered. What it doesn't: that a case was won or that anyone was helped in a larger sense.

### Sponsorship pledges (pay for proven results)

The link from a donor's money to delivered work is on the ledger, not in a popup.

1. A donor clicks **Sponsor a case** on the impact page and picks $25, $50 or $100 ($25 = one brief). No name, email or wallet is asked for. In the hackathon build no money moves; the pledge itself is real and public on NEAR testnet.
2. `chain/pledge.ts` matches the pledge to specific briefs that were **already delivered and anchored** (oldest unfunded first) and writes `papertrail-impact.testnet/papertrail/pledge/<PT-XXXXXXXX>` to SocialDB:
   `{ v: 1, pledge_id, amount_usd, briefs, week_of, status, funds: [{ batch_id, leaves: [<leaf hashes>] }] }`
3. If every delivered brief already has a sponsor, the pledge waits. `anchor.ts` runs `matchWaiting()` after each new batch and writes the updated record.
4. The donor gets a tracking link (`/papertrail?pledge=PT-...`). "Trace my pledge on NEAR" checks, in the browser, from NEAR RPC and the public receipts: the pledge exists on-chain, the batch root on NEAR matches its receipts, each funded leaf is inside that batch, each carries a valid TEE signature, and **no other pledge on-chain claims the same brief**. The same checks run from the command line: `bun chain/verify-pledge.ts PT-XXXXXXXX`.

Why it's safe: a leaf is a hash of a random `receipt_id` and the enclave's signature, so the pledge points at proof of work, never at a person. Pledges are written at the donor's time, not the user's, so they add no timing signal about users. Abuse limits: 30 pledges per hour, 50 waiting at most.

Why it's different from earlier donor-tracking chains: the outcome isn't confirmed by a human third party (Alice.si) or a private permissioned ledger (WFP Building Blocks). Sealed hardware signs the work, the public ledger holds only fingerprints, and double-counting is checkable by anyone.

Links:

- Pilot batch `b1` (written before the guardrails existed: exact count 3, languages on-chain): tx `4LtmhGZRsyhCJMFVr6kkWsQu8N27WsE1gzY7JMoJtt94`
- Public feed: https://kikib.zo.space/api/papertrail/impact (`impact.ts`)
- Public impact page: https://kikib.zo.space/papertrail (`impact-page.tsx`): totals, a "Verify in this browser" button per batch (checks every TEE signature, recomputes the root, reads NEAR RPC directly), and "Sponsor a case", which writes a testnet pledge and shows its tracker.
- Pledge API: `POST https://kikib.zo.space/api/papertrail/pledge {"amount":25}`, `GET ...?id=PT-...`, `GET` for totals (`pledge-api.ts`)

Anti-scam: on first contact and on `SCAM` / `ESTAFA`, users get a fixed English or Spanish message: Paper Trail will never ask for money, crypto or a digital wallet; anyone claiming to be Paper Trail, USCIS, ICE, the court or a lawyer who asks for crypto or gift cards is a scammer; report at reportfraud.ftc.gov.

## Try it (judges)

Needs [Bun](https://bun.sh). No keys needed for steps 1–3.

1. See the anchored batches: open https://kikib.zo.space/api/papertrail/impact → JSON with totals and a NEAR explorer link per batch.

2. Verify batch b1 yourself against NEAR testnet:

   ```sh
   cd chain && bun install
   bun verify.ts https://kikib.zo.space/api/papertrail/impact?batch=b1
   ```

   → each TEE signature checks out, the recomputed Merkle root equals the root stored on SocialDB, last line `VERIFIED`.

3. Trace a sponsorship pledge to the briefs it paid for:

   ```sh
   bun verify-pledge.ts PT-63AC8205
   ```

   → the pledge record is read from NEAR, its 2 funded briefs are found inside batch `2026-W46-01`, their TEE signatures check out, no other pledge claims them, last line `VERIFIED`. In a browser: open https://kikib.zo.space/papertrail?pledge=PT-63AC8205 → "Trace my pledge on NEAR" → 5 green checks. Or click "Sponsor a case" to make your own pledge.

4. Generate fake specimen documents: `python3 test/make_fake_docs.py` → JPGs in `test/fake-docs/`, all marked SPECIMEN.

5. Full conversation (needs a NEAR AI key as `near_key`, running the route locally or on Zo): `python3 test/demo.py <route_url>` → prints every reply of a Spanish session: document reads, the save filter blocking "me arrestaron en 2019", `LIST`, `BRIEF`, `PROOF`.

6. Seed and anchor a batch: run step 5 with `--short` and 10 different `--from=whatsapp:+1555...` numbers, then `cd chain && bun anchor.ts --now` (needs a funded testnet account key as `near_impact_key` or in `~/.near-credentials`; without one it prints the record it would write).

## Source and tests

- `route.ts`: copy of the live zo.space WhatsApp webhook route (`/api/papertrail`).
- `impact.ts`: copy of the public impact feed route (`/api/papertrail/impact`).
- `pledge-api.ts`: copy of the pledge route (`/api/papertrail/pledge`).
- `impact-page.tsx`: copy of the public impact page (`/papertrail`).
- `chain/`: `anchor.ts` (verify receipts, write Merkle root to NEAR testnet), `verify.ts` (anyone can re-check a batch), `pledge.ts` (create and match pledges), `verify-pledge.ts` (anyone can trace a pledge), `create_account.ts` (testnet account via the faucet helper), `lib.ts`.
- `test/make_fake_docs.py`: generates fake documents marked SPECIMEN (never use real IDs).
- `test/demo.py`: runs a full Spanish conversation against the route in dry-run mode and prints every reply.

## Secrets (Zo Settings > Advanced)

`near_key`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `near_impact_key` (optional). Without the Twilio pair, the route runs in dry-run mode and writes replies to `data/dryrun.log`. Without a NEAR signing key, `chain/anchor.ts` runs dry and writes to `data/impact/dryrun.log`.

## Libraries

`near-api-js` 5, `ethers` 6 (ECDSA signature recovery), Bun, Hono (zo.space runtime), Twilio WhatsApp Sandbox, Python Pillow (fake docs). Code written with AI assistance (Claude). No pre-hackathon code: all code was written from Nov 11, 2026.

## License

MIT, see `LICENSE`.

## Known gap (say it first in the pitch)

WhatsApp is end-to-end encrypted to the Business API, where Twilio/Meta decrypt it. The AI step is private and media is deleted right away; transport is the remaining trust point. Roadmap: Signal option, on-device redaction.

The ledger proves a TEE-verified brief was delivered, not case outcomes. Batches are delayed and bucketed to reduce re-identification in small communities. The receipts file for each batch lists every receipt so anyone can verify it, which means the exact count of a batch can be read off-chain.

Pledges are a hackathon stand-in for payment: no money moves, and nothing stops someone from pledging and not paying. In production the pledge would be written only after a payment clears. Pledge `PT-63AC8205` has two on-chain writes: the first wrongly reused a brief already funded by `PT-20B0DEC8` (a bug in the matcher, fixed the same hour); the second, current record corrects it. Both stay visible on NEAR.