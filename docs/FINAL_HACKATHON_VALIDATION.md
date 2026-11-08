# SellerShield AI: Final Hackathon Validation (authoritative status)

Audit date: 2026-11-08 · Environment: Windows 11, Node 26, SQLite · All secret values are redacted; only variable names, lengths and pass/fail are recorded.
Labels: **LIVE VERIFIED** (real external API) · **MOCK TESTED** (local test server) · **EMULATOR TESTED** (local PayPal emulator, not PayPal) · **LOCAL** (local code path, no external service) · **NOT TESTED** · **BLOCKED** (needs an external action).

## 1. Executive summary
SellerShield AI is a merchant-side commerce-security platform: it attacks a simulated shop and PayPal's payment protocol, discovers attack sequences (scripted, exhaustive search, and an LLM tool-use agent), verifies every claim by deterministic replay against a secure baseline, and turns approved fixes into patches, regression tests and (designed) draft GitHub PRs.

**Completed and verified this pass:** real PayPal Sandbox OAuth and the **full PayPal red-team protocol probes (RT-01 to RT-06) on a real, human-approved Sandbox order**, plus a live reconciliation (RT-07); a real Groq LLM discovery session through the UI (2 findings independently verified, 17+ live rate-limit responses recovered by backoff); Gemini disabled by default and skipped gracefully; security cleanup (secret scan clean, JWT secret was the public placeholder and is now rotated, `.env.backup` deleted); new GitHub preflight/verification code; evidence screenshots; 117 backend tests and 26 browser checks.
**Not completed (external action required):** a real GitHub draft PR (no `GITHUB_REPO`, token rotation unconfirmed), real PayPal webhook signature verification (no registered webhook / public HTTPS URL).
**Overall: READY WITH LIMITATIONS.** The product, simulator, verification, UI and a live LLM/PayPal subset genuinely work; three integrations remain unproven live and must not be presented as working.

## 2. Priority-wise completion
| Priority | Task | Status | Action performed | Evidence | If incomplete, why? |
|---|---|---|---|---|---|
| 1 | PayPal Red Team | **COMPLETED** (RT-01..RT-07 LIVE VERIFIED on real Sandbox; RT-08/09 are SellerShield-side checks) | Fresh real run; human approved the order as a Sandbox buyer; Continue executed capture, capture replay, duplicate capture, refund, refund replay, over-refund and reconciliation against PayPal Sandbox; found and fixed an RT-07 amount-parsing bug | `docs/screenshots/final/LIVE-paypal-redteam-sandbox-phaseA.png`, `...-phaseB-complete.png`, `...-phaseB-complete-2.png`; `docs/redteam-live-sandbox-run.json` (run `cmw7edbba0003v4iotkklfbxm`, order `9W579655A7779603T`) | Webhook-related probes against a real PayPal delivery remain blocked (Priority 3) |
| 2 | GitHub Defence | **BLOCKED** | Inspected implementation; added richer PR body (reproduction, root cause, security impact, limitations), a read-only preflight (`GET /api/github/status`) and post-creation verification against the GitHub API (draft, branches, files, test, not merged); MOCK TESTED | tests in `backend/tests/features.test.ts` (MOCK); no real PR URL exists | `GITHUB_REPO` is not set (no dedicated test repo); the token in `.env` has unconfirmed rotation and I will not reuse a possibly-compromised credential |
| 3 | PayPal Webhooks | **COMPLETED (LIVE VERIFIED, with limits)** | Webhook registered on the Render-hosted backend; three real PayPal Sandbox deliveries (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`) were verified by SellerShield through PayPal's `verify-webhook-signature` API and cross-checked against PayPal's Developer Dashboard (Webhook Events, SellerShield AI app, all Success), 2026-11-08; LOCAL forged/malformed/replay tests also pass | `docs/WEBHOOK_SETUP.md`; PayPal Dashboard event log | Real events were stored as `ignored` (authentic, but no matching stored transaction, so no state change); for a real redelivery, a Dashboard *Resend* of one event id was DELIVERED (PayPal attempt history, 2026-11-08 9:35 PM) and no second row was stored, which is consistent with duplicate handling; the HTTP response body was not captured |
| 4 | Gemini | **COMPLETED** (kept disabled) | `GEMINI_ENABLED` flag (default off); active provider list is `groq` only (verified via `/api/health` and `/api/discovery/config`); MOCK test that Gemini stays off even with a key; stale Anthropic/AI_* references removed | `health`: provider `groq`; test "Gemini stays DISABLED by default" | n/a (Gemini remains BLOCKED by Google billing, intentionally unused) |
| 5 | Security cleanup | **PARTIALLY COMPLETED** | Secret scan; JWT secret rotated; backup overwritten and deleted; probes; audit | §6 | GitHub token rotation and OneDrive copies need owner action; dependency advisories not upgraded |
| 6 | Presentation | **PARTIALLY COMPLETED** | Real labelled screenshots; this report; docs updated; 7-10 min demo script; judge Q&A | `docs/screenshots/final/` (7 files) | No screenshots of a real GitHub PR or real webhook (blocked); no backup video recorded |

## 3. Detailed completion report
### Priority 1: PayPal Red Team
- **Already implemented:** red team module (`redteam.ts`), emulator, UI card, DB-persisted runs, sandbox-only guard (`PAYPAL_BASE_URL` must contain "sandbox").
- **Inspected:** configuration confirms `https://api-m.sandbox.paypal.com`; `/api/paypal/status` → `oauth: ok` (LIVE).
- **Executed (all LIVE on PayPal Sandbox, one order, buyer approval done by a human):**
  | Probe | PayPal operation | HTTP | Expected | Actual | Result |
  |---|---|---|---|---|---|
  | RT-01 | `POST /v2/checkout/orders` ×2, same `PayPal-Request-Id` | 2xx | same order id | `9W579655A7779603T` both | PASS |
  | RT-02 | `POST /v2/checkout/orders/{id}/capture` before approval | 422 | `ORDER_NOT_APPROVED` | `ORDER_NOT_APPROVED` | PASS |
  | RT-03 | `POST .../capture` ×2 (same Request-Id) | 2xx | same capture id | `6H6581514J8319405` both | PASS |
  | RT-04 | `POST .../capture` (new Request-Id) after capture | 422 | `ORDER_ALREADY_CAPTURED` | `ORDER_ALREADY_CAPTURED` | PASS |
  | RT-05 | `POST /v2/payments/captures/{id}/refund` $100 ×2 (same Request-Id) | 2xx | same refund id | `5KP7598866884964C` both | PASS |
  | RT-06 | refund $100 again (new Request-Id; only $26 left of $126) | 422 | `REFUND_AMOUNT_EXCEEDED` | `REFUND_AMOUNT_EXCEEDED` | PASS |
  | RT-07 | reconcile NovaCart simulator ledger vs PayPal refund record (`GET /v2/payments/refunds/{id}`) | n/a | equal | NovaCart $200 vs PayPal $100 → **divergence $100** | WEAKNESS (in NovaCart's logic; PayPal capped the payout) |
  | RT-08 / RT-09 | forged / replayed webhook against **SellerShield's own endpoint** | n/a | rejected / duplicate | rejected / duplicate | PASS, source `sellershield` (LOCAL, not a PayPal delivery) |
- **Bug found by the live run and fixed:** the first live RT-07 said "PayPal refunded $0 → divergence $200". Real PayPal omits the amount in the create-refund response (my emulator included it, hiding the bug). The code now reads the amount from the refund record; the emulator now mimics real PayPal so tests catch it (117 tests pass); the stored run's RT-07 was recomputed from PayPal's real record (`backend/scripts/recompute-rt07.ts`) and carries a `correctedFrom` note.
- **Other changes:** demo reset now never deletes real Sandbox runs; the card has a recent-runs selector.
- **Real Sandbox money:** none (Sandbox only). One capture of $126 and one refund of $100 exist in the owner's Sandbox account.
- **Not covered:** webhook deliveries for these captures/refunds (no registered webhook, Priority 3).

### Priority 2: GitHub defence
- **Implemented:** GitHub REST API via `fetch` (no CLI); branch from base SHA, three files, draft PR, token never returned/logged.
- **Changed:** PR report now contains description, reproduction steps and evidence, root cause, patch, regression test, before/after results, security impact, remaining limitations; `verifyPullRequest()` re-reads the PR from GitHub (draft, head/base branches, exact file list, regression test present, not merged); `githubPreflight()` is read-only.
- **Executed:** MOCK TESTED only (3 new tests). The generated regression tests were executed earlier and pass.
- **Not executed:** any real GitHub call. No PR number/URL exists.
- **Owner must:** revoke the token that was pasted in chat; create a replacement fine-grained token for a **dedicated test repo** (Contents RW, Pull requests RW, Metadata RO); set `GITHUB_TOKEN` and `GITHUB_REPO=owner/repo` in `backend/.env` (never in chat); ensure the repo has a `main` branch; open `GET /api/github/status` (must show `ok: true`); then Defence Center → verified defence → Preview → Open draft pull request.

### Priority 3: PayPal webhooks
- **Implemented:** raw-body endpoint, PayPal `verify-webhook-signature` call, unique event ids, unverified events stored but never processed.
- **Changed:** `PAYMENT.CAPTURE.REVERSED` is now handled; simulator accepts it.
- **LOCAL results (curl against the real endpoint):** unsigned/forged → 401 `rejected_unverified`; missing `event_type` → 400; malformed JSON → 400. MOCK/LOCAL (vitest): replay → duplicate; REVERSED processed under local HMAC simulation.
- **LIVE VERIFIED (2026-11-08):** three real PayPal Sandbox deliveries (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`) were verified by SellerShield through PayPal's `verify-webhook-signature` API and cross-checked against PayPal's Developer Dashboard (Webhook Events, SellerShield AI app, all Success), 2026-11-08.
- **Partially tested:** a Dashboard *Resend* of one event id was DELIVERED (PayPal attempt history, 2026-11-08 9:35 PM) and no second row was stored, which is consistent with duplicate handling; the HTTP response body was not captured.
- **Not tested:** real events driving a state change (they were authentic but `ignored`, no matching stored transaction). RT-08/RT-09 remain SellerShield-side checks (forged payload, local HMAC replay).

### Priority 4: Gemini (kept disabled)
- Gemini returned HTTP 403 (billing) on every model in the earlier live validation; not retried.
- `llmProviders()` includes Gemini only when `GEMINI_ENABLED=true`; otherwise skipped without any request. Verified: `GET /api/discovery/config` → providers `[groq]`; `/api/health` → `provider: groq`.
- GroqCloud is the active provider; the deterministic guided search is always available (LOCAL, ran this pass); if Groq is unavailable the LLM engine reports "all providers failed" and creates no findings (MOCK TESTED).
- No Anthropic code, config or docs remain (grep clean except one `.env.example` comment saying it is no longer used).

### Priority 5: Security cleanup
See §6.

### Priority 6: Presentation
Screenshots, docs, demo script and Q&A updated; see §7 and `docs/SELLERSHIELD_LIVE_DEMO_SCRIPT.md`, `docs/JUDGE_QUESTIONS_AND_ANSWERS.md`.

## 4. Live integration evidence
| Provider | Operation | Live API? | Result | Evidence |
|---|---|---|---|---|
| PayPal | OAuth | **Yes** (re-run this pass) | PASS | `/api/paypal/status` → `oauth: ok`; e2e check 21 |
| PayPal | Order creation / idempotency / capture-before-approval | **Yes** (re-run this pass, order `9W579655A7779603T`) | PASS | screenshot `LIVE-paypal-redteam-sandbox-phaseA.png` |
| PayPal | Order approval | Yes (human buyer on sandbox.paypal.com) | **PASS** (order status became APPROVED, then captured) | RT-03 capture succeeded |
| PayPal | Capture | **Yes** | PASS: capture `6H6581514J8319405`; replay same id; duplicate rejected `ORDER_ALREADY_CAPTURED` | `redteam-live-sandbox-run.json` |
| PayPal | Refund | **Yes** | PASS: refund `5KP7598866884964C`; replay same id; over-refund rejected `REFUND_AMOUNT_EXCEEDED` | same |
| PayPal | Webhook verification | No | **LIVE VERIFIED** (3 real Sandbox deliveries, cross-checked in PayPal's Dashboard); a real Resend was delivered and not stored twice (response body not captured) | `docs/WEBHOOK_SETUP.md` |
| GroqCloud | Tool calling | Yes (earlier today, `validate-llm.ts`; not repeated to conserve free-tier quota) | PASS | `docs/llm-live-validation.json` |
| GroqCloud | Structured output | Yes (earlier today) | PASS (tool-call args + prompt+Zod). `response_format: json_object` rejected with HTTP 400 on `openai/gpt-oss-120b`, so it is not used | same |
| GroqCloud | Attack discovery | **Yes** (re-run this pass through the real UI → API → DB) | PASS: 2 findings, both independently verified | `LIVE-discovery-groq-llm-session*.png` |
| GitHub | Draft PR creation | No | **BLOCKED** (MOCK TESTED only) | no PR URL |
| Gemini | Text generation | Yes (earlier) | **FAIL/BLOCKED**: HTTP 403 billing; disabled by default | `LLM_LIVE_VALIDATION.md` |

### The live discovery findings (this pass, Groq `openai/gpt-oss-120b`, 18 model turns, 0 failovers)
1. *"Exploit 100% Coupon + Refund on Zero-Priced Order"* ($120 simulated). The model had an admin set coupon SAVE20 to 100%, created a $0 order, then a list-price refund paid out $120. Verified on vulnerable vs secure shop; blocked by `refund-calc` or `refund-permission`.
2. *Intern refund on a discounted order* ($120 simulated; model never called `report_attack`, so the title is generic). An intern refunded the $120 list price of a $96 order. Blocked by `refund-permission`.
**Honest reading:** both are **known root causes** (list-price refunds, missing role checks). "Novel" means only that the violation pattern is not produced by a single scripted scenario. For finding 2, the true monetary over-refund is $24; the $120 is the refund the secure baseline would have refused outright (an intern may not refund), so "$ excess" there measures a policy violation, not only extra money. An earlier live session (documented in `LLM_LIVE_VALIDATION.md`) found a $24 "Over-refund Headset"; **the model is non-deterministic and did not repeat that finding**, and there is no screenshot of it.

## 5. Test results (actual counts)
| Test category | Total | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Backend (vitest, 5 files; all MOCK/LOCAL, isolated from real credentials by a guard test) | 117 | 117 | 0 | 0 |
| Frontend type check (`tsc --noEmit`) | 1 run | pass | 0 | 0 |
| Production build (`next build`) | 1 run | compiled successfully | 0 | 0 |
| Browser E2E (`e2e/e2e.js`, headless Chrome; PayPal check is OAuth-only in Sandbox mode, red-team check forced to emulator, LLM not run; re-run on the final build after the last frontend change) | 26 | 26 | 0 | 0 |
| Security checks (§6: probes + secret scan) | 11 | 11 as expected | 0 | 0 |
Note: the first browser-suite invocation of this pass produced no output; it was rerun and the clean run (26/26, exit 0) is the one reported.

## 6. Security audit
| Check | Result |
|---|---|
| **GitHub token** | The token pasted in chat is **compromised; revocation not confirmed** (outstanding owner action). The configured token (length consistent with a fine-grained PAT) was **not used** this pass; I cannot tell if it is a replacement. `GITHUB_REPO` is unset. |
| **Secret scan** (`backend/scripts/secret-scan.ts`, 260 text files incl. `frontend/.next`) | Actual values of `GROQ_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `JWT_SECRET` found **nowhere** in the project; only a deliberately fake `sk-…` fixture in `unit.test.ts`. No secrets in frontend bundles. Screenshots can't be text-scanned; reviewed by eye (the PayPal screenshot shows only order ids/URLs, no secrets). |
| **Finding: JWT_SECRET was the public placeholder** from `.env.example` | **Fixed**: replaced with a random 96-char value (not displayed). A token signed with the old placeholder is now rejected (HTTP 401). Existing sessions were invalidated. |
| **`.env` / backups in git** | `.gitignore` ignores `.env` and `.env.*` (allows `.env.example`) and databases. **The folder is not a git repository, so there is no history to inspect**; run `npx tsx backend/scripts/secret-scan.ts` before the first commit and `git status` to confirm nothing sensitive is staged. |
| **`.env.backup`** | Compared by hash: identical to `.env` for every shared variable; extras were only the removed Anthropic/`AI_*` placeholders (the Anthropic key was empty). Overwritten with random bytes, then deleted. **Limits:** this is not cryptographic erasure (SSD wear-levelling, filesystem journaling). **The project lives in OneDrive**, so earlier copies of `.env` and `.env.backup` may exist in OneDrive's cloud, version history and recycle bin. |
| Authentication/authorization | Unauthenticated API → 401; forged JWT → 401; role and tenant isolation covered by tests |
| CORS | A disallowed origin receives only the app's own origin; browsers block it |
| Rate limiting | 40 rapid bad logins → 29×401 then 11×429 |
| Input validation / injection | SQLi-style email → 400 (Zod); Prisma only, no raw SQL; no `eval`/`innerHTML`/shell execution |
| Webhook security | Forged → 401 and not processed; missing fields/malformed → 400 (LOCAL). Real signature verification LIVE VERIFIED on 3 Sandbox events (2026-11-08) |
| Sensitive logging | Provider errors, traces and prompts are redacted; keys never appear in API responses (tested) |
| Dependency advisories | `npm audit --omit=dev`: backend 4 high (zod < 4.6.6, prisma tooling), frontend 1 moderate + 1 high (next/postcss). **Not upgraded** (breaking majors); documented |
| Test isolation | Guard test proves tests load no real credentials (`ppMode`, LLM and GitHub all off in tests) |
**Remaining risks:** compromised GitHub token if not revoked; secrets possibly retained in OneDrive; demo login grants an unauthenticated admin session when `DEMO_MODE=true`; dependency advisories; in-process jobs; no CSP tuning.

## 7. Evidence inventory
- `docs/screenshots/final/LIVE-paypal-redteam-sandbox-phaseA.png`: live Sandbox probes + approval link (LIVE VERIFIED)
- `docs/screenshots/final/LIVE-paypal-redteam-sandbox-phaseB-complete.png` and `...-complete-2.png`: all nine probes after real approval (LIVE VERIFIED for RT-01..RT-07)
- `docs/redteam-live-sandbox-run.json`: exported live run record (no credentials)
- `docs/screenshots/final/LIVE-discovery-groq-llm-session.png` and `...-fullpage.png`: live Groq discovery trace and verified findings (LIVE VERIFIED)
- `docs/screenshots/final/LOCAL-discovery-guided-search-cancel-for-cash.png`: guided search finding Cancel-for-Cash (LOCAL, no AI)
- `docs/screenshots/final/LOCAL-dashboard-demo-fixture.png`, `LOCAL-defence-center-proposed-patch.png`, `LOCAL-six-agents-control-center.png`: demo-fixture data from the local simulator (LOCAL)
- `docs/screenshots/*.png`: earlier full-flow set (LOCAL/EMULATOR; `13-paypal-sandbox-connected.png` is live OAuth status)
- `docs/llm-live-validation.json` (+ `LLM_LIVE_VALIDATION.md`): per-call live log, keys redacted
- `e2e/results/e2e-results.json`: browser suite results
- Scripts: `backend/scripts/secret-scan.ts`, `backend/scripts/validate-llm.ts`, `e2e/evidence.js`, `e2e/e2e.js`
- Docs: `docs/WEBHOOK_SETUP.md`, this file
- **No evidence exists for:** a real GitHub PR, a real webhook delivery, live capture/refund. Three screenshots captured at the login page by mistake (rate limiter tripped by my own security probe) were **deleted and recaptured**, not kept.

## 8. Outstanding actions
| # | Item | Blocker / why I could not do it | Owner steps | Affects demo? |
|---|---|---|---|---|
| 1 | ~~Red team phase B~~ | **Done** (human approved; see §3) | none | n/a |
| 2 | Revoke compromised GitHub token | Only the owner can | github.com/settings/tokens → delete the token pasted in chat | Security, not demo |
| 3 | Real draft PR | No `GITHUB_REPO`; token rotation unconfirmed | Create a dedicated test repo; new fine-grained token (Contents RW, PR RW, Metadata RO) in `backend/.env`; set `GITHUB_REPO`; check `GET /api/github/status`; Defence Center → Preview → Open draft PR; **do not merge** | Yes (nice-to-have) |
| 4 | Real webhook verification | Needs public HTTPS + Dashboard registration | Follow `docs/WEBHOOK_SETUP.md` | Yes (nice-to-have) |
| 5 | OneDrive exposure | Cloud/storage actions are outside this tool | Move the project outside OneDrive (or exclude `backend/.env`); delete `.env.backup` from the OneDrive web recycle bin and version history; consider rotating Groq/PayPal/GitHub keys | Security |
| 6 | Licence file | Submission needs an open-source licence visible on the repo; choosing one is the owner's decision | Add `LICENSE` (e.g. MIT/Apache-2.0) | **Required for submission** |
| 7 | Public repo, video | Not done | `git init`, run the secret scan, push to a public repo; record ≤3 min video; fill placeholders (team, URLs) | Required for submission |
| 8 | Gemini | Needs Google billing | Leave off unless you intentionally enable billing and set `GEMINI_ENABLED=true` | No |

## 9. Final readiness assessment
- **Application functionality:** strong. Full demo, simulator, auditor, patching, regression memory, discovery lab, red team and reports work and are browser-tested.
- **Real API integration:** partial. LIVE: PayPal OAuth, order creation/idempotency, approval, capture, capture replay, duplicate capture, refund, refund replay, over-refund rejection and reconciliation; Groq tool calling/structured output/discovery. NOT live: webhooks, GitHub PR.
- **Security:** good after cleanup, with owner-side items (token revocation, OneDrive copies) and unpatched dependency advisories.
- **Test coverage:** 117 backend + 26 browser, honest about mocks; no frontend unit tests.
- **Presentation readiness:** good: labelled evidence, 7-10 min script, Q&A; missing backup video and any real PR/webhook evidence.
- **Overall: READY WITH LIMITATIONS.** Present PayPal (Orders, capture, refund, idempotency, reconciliation) and Groq as live-verified *for the specific probes listed*; present GitHub PRs and webhook verification as designed and mock/locally tested, not live. Completing Outstanding Actions 6 and 7 (licence, public repo, video) is now the most valuable remaining work.

---
## 10. Submission checklist (final pass, 2026-11-08)
Re-validated on the final state: backend **117/117**, backend + frontend type-checks pass, clean production build (18 static pages), browser **26/26**, secret scan clean (only the fake `sk-…` test fixture), live Sandbox run preserved.

| # | Requirement | Status | What was done | Blocker / exact manual action |
|---|---|---|---|---|
| 1 | **Open-source LICENSE** | **COMPLETED (file created)** | MIT chosen by the owner; `LICENSE` created in the project root with the exact line `Copyright (c) 2026 Sanjay B.`; dependency licences inspected (all permissive) | After pushing, confirm GitHub shows "MIT license" in the repo's About section |
| 2 | **Public GitHub repository** | **PARTIALLY COMPLETED** | `git init -b main` locally; `.gitignore` hardened; 134 files staged; no `.env`/database/credential files staged; real secret values searched in every staged file: none; secret scanner clean; no commits exist, so no history to leak | (a) Confirm the destination (`owner/name`) and **public** visibility; (b) set a git identity (`git config user.name` is unset; I won't invent one); (c) `LICENSE` is already created and staged; (d) then commit and push. **Warning:** the project folder is inside OneDrive; git repos inside OneDrive can corrupt. Prefer cloning the pushed repo to a non-OneDrive folder afterwards |
| 3 | **GitHub Defence: one real draft PR** | **BLOCKED** | Code ready and mock-tested (preflight `GET /api/github/status`, draft PR, post-creation verification). `GITHUB_TOKEN` is set; `GITHUB_REPO` is not | Confirm the old token is **revoked**; create a replacement fine-grained token for a **dedicated test repository** (Contents RW, Pull requests RW, Metadata RO) in `backend/.env`; set `GITHUB_REPO=owner/test-repo` and ensure it has a `main` branch; confirm in chat ("create the draft PR"). I cannot verify revocation myself without using the token |
| 4 | **Demo video < 3 min** | **PARTIALLY COMPLETED** | Script, shot list, timestamps, labels and recording checklist: `docs/DEMO_VIDEO_SCRIPT.md`; submission text: `docs/SUBMISSION_TEXT.md` | Record the video yourself (I cannot capture your screen), upload to YouTube as **Public**, paste the link into the form |
| 5 | **Final validation** | **COMPLETED** | See the line above; this section | n/a |
| 6 | Text description + tools list | **PARTIALLY COMPLETED** | Drafted in `docs/SUBMISSION_TEXT.md` (MIT noted; tools list covers PayPal, Groq, Gemini (disabled), GitHub API and the application stack only) | Fill team name and links |
| 7 | Functional demo instructions | **COMPLETED** | `README.md`, `docs/INSTALLATION_GUIDE.md` | none |
| 8 | PayPal webhook verification (optional, strengthens "PayPal central") | **COMPLETED** | Live verified on the Render deployment (3 events) | `docs/WEBHOOK_SETUP.md` |
| 9 | Licence notes | **COMPLETED** | `png-js` (via pdfkit) has no licence field in its manifest (upstream is MIT); `jszip` is dual MIT/GPL (take MIT); `sharp`'s prebuilt libvips binary carries LGPL-3.0 (an optional Next.js image dependency, not modified or bundled in our source); two MPL-2.0 packages (file-level copyleft, fine for MIT/Apache). No copyleft obligations fall on our own code | none |
