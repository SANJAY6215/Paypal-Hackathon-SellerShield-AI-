# Feature Add-on: Discovery Lab, PayPal Red Team, Defence-as-PR

Added 2026-11-08. All three make PayPal and AI *central* instead of optional, but **their real-service paths have not been run against the real services** (no credentials were available). This page says exactly what is verified and how to turn each on.

| Feature | What it does | Verified how | NOT verified |
|---|---|---|---|
| **1. PayPal Red Team** (`backend/src/redteam.ts`, `/paypal` page) | Automated attacker probes the PayPal Orders/Payments protocol (idempotency, capture-before-approval, capture replay, refund replay, over-refund), replays the Siphon money flow, **reconciles NovaCart's ledger against PayPal's refund records**, and attacks SellerShield's own webhook endpoint (forged, replayed) | 9 probes pass in tests and in the browser against a **local PayPal emulator** (`mocks/paypal-emulator.ts`, labelled "EMULATOR - NOT PAYPAL"); the Sandbox code path (pause for buyer approval → continue) is exercised against the emulator via a URL containing "sandbox" | Real PayPal Sandbox responses, real buyer approval, real webhook signature verification |
| **2. Attack Discovery Lab** (`backend/src/discovery.ts`, `/discovery` page) | An attacker invents *sequences of shop actions*; deterministic code replays them on the vulnerable shop and a fully secure baseline, checks ledger invariants and determinism. Two engines: **guided search** (no AI, ~155k sequences) and an **LLM tool-use agent** with provider failover (Gemini → Groq, OpenAI-style function calling) | Search: finds *Cancel-for-Cash* (3 actions, $160 simulated) which is not in the scripted library; disappears after the `payment-state` fix. LLM loop: **LIVE** against Groq `openai/gpt-oss-120b` (a real session verified one attack and rejected another; 17 real 429s recovered by backoff) and **MOCK** tests for the failure paths; see `LLM_LIVE_VALIDATION.md` | Gemini success path (blocked: free tier unavailable for the project, HTTP 403); a benchmark of how often a model finds something new |
| **3. Defence as Pull Request** (`backend/src/github.ts`, Defence Center) | A verified, human-approved fix becomes a **draft** GitHub PR with the diff, a runnable regression test and an evidence report. Never merges, never writes to the base branch | Against a **local mock of the GitHub API** (branch from base SHA, 3 files, draft PR, token never in responses/logs, 409 if unapproved/unverified/duplicate, 400 without confirm, 422 without config). A generated regression test was executed and passes | Real GitHub (token scopes, branch protection, rate limits) |

## Real PayPal Sandbox evidence (2026-11-08, re-run on a fresh order the same day)
With Sandbox credentials supplied in `backend/.env`:
- **OAuth client-credentials against `api-m.sandbox.paypal.com`: succeeded** (`/api/paypal/status` → `oauth: ok`).
- **Red team phase A against real PayPal Sandbox: PASS.** RT-01 (two `POST /v2/checkout/orders` with the same `PayPal-Request-Id` returned the same order id) and RT-02 (capture of an unapproved order returned HTTP 422 `ORDER_NOT_APPROVED`) both behaved securely; results are tagged `paypal-sandbox`.
- Latest live run: order `9W579655A7779603T`, run `cmw7edbba0003v4iotkklfbxm`: **human buyer approved; phase B executed on real Sandbox: capture, capture replay, duplicate-capture rejection, refund, refund replay, over-refund rejection and reconciliation all behaved as expected (RT-01..RT-06 PASS; RT-07 reconciliation divergence $100).** Details: `FINAL_HACKATHON_VALIDATION.md` §3; record: `docs/redteam-live-sandbox-run.json`. Real Sandbox runs are never wiped by a demo reset.
- **Webhook signature verification: LIVE VERIFIED** on 3 real Sandbox deliveries (see `WEBHOOK_SETUP.md`). Still NOT tested live: a real redelivery of the same event id, and the PayPal page's manual order/capture/refund buttons.

## 1. PayPal Red Team
- Targets: **emulator** (always available, clearly labelled) or **sandbox** (needs `PAYPAL_CLIENT_ID/SECRET`; refuses any URL without "sandbox").
- Real Sandbox needs a human buyer: the run pauses at `awaiting_approval` with the approval link; press *Continue after buyer approval*.
- Headline finding (RT-07): PayPal's capture cap and Request-Id idempotency stop the platform from paying the extra $100, **but NovaCart's own refund logic would approve and book $200**: ledger divergence $100. The fix must live in NovaCart (`refund-calc`, `refund-idempotency`); after applying them RT-07 becomes secure (tested).
- Each probe result carries `source`: `paypal-sandbox`, `paypal-emulator` or `sellershield`.

## 2. Attack Discovery Lab
- Verified means: ≥1 action succeeded, secure baseline keeps more money than the vulnerable shop, ≥1 ledger invariant violated (new invariant: *refund-without-settlement*), identical second replay, ≤12 actions. Attacker rationale is displayed but never used as evidence.
- Novelty = the violation set is not produced by any scripted scenario or scripted chain (`classifyNovelty`). "Novel" means *not in the scripted library*, not "unknown to the world". Cancel-for-Cash is a **new path to the same root cause as PAY-001** (`payment-state`); the lab reports which fixes block each finding.
- LLM engine uses **Groq by default**; Gemini is **disabled unless `GEMINI_ENABLED=true`** (its Google project needs billing; HTTP 403). Provider order: `LLM_PROVIDER_ORDER`, default gemini,groq (Gemini skipped when disabled). Errors fail over (401/403 key rejected, 5xx, timeout); HTTP 429 first waits (honours `retry-after`, ≤65 s, up to 5 retries) and only then fails over; a provider with a rejected key is skipped for 10 minutes. Verified models: `gemini-2.5-flash`, `openai/gpt-oss-120b` (see `LLM_LIVE_VALIDATION.md`; model names are configurable via `GEMINI_MODEL` / `GROQ_MODEL`). Max 14 turns/attempt, at most 12 shop actions, 30 s timeout per call, traces redacted. Without any key the option is disabled.
- Runs only against the simulated NovaCart shop.

## 3. Defence as Pull Request
**Status: BLOCKED for a real PR** (`GITHUB_REPO` unset; token rotation unconfirmed); only MOCK TESTED. Added: richer PR content, read-only preflight `GET /api/github/status`, and post-creation verification against the GitHub API.
Requirements enforced by the API: defence status `verified` (regression tests passed) → human-approved → role admin/analyst → explicit `{"confirm": true}` → `GITHUB_TOKEN` + `GITHUB_REPO` configured. Files: `sellershield/fixes/<fix>.patch`, `sellershield/regression/<fix>.test.ts`, `sellershield/reports/<fix>.md`. The PR does not change application code by itself; merging is the repo owner's decision. Token scopes needed: contents write + pull requests write.

## Enable the real paths
```
# backend/.env
PAYPAL_CLIENT_ID=...  PAYPAL_CLIENT_SECRET=...  PAYPAL_WEBHOOK_ID=...   # red team + PayPal page, Sandbox only
GEMINI_API_KEY=...  GROQ_API_KEY=...     # LLM attacker + explanations with failover (Gemini needs billing enabled on its project)
GITHUB_TOKEN=...  GITHUB_REPO=owner/repo                                  # pull requests
```
Then run each once and record what actually happens. Update this page and `FINAL_TECHNICAL_VALIDATION.md` with the results before claiming any of it works.

## Tests
`backend/tests/features.test.ts` (21 tests): search discovery and novelty, verification rejections, strict action schema, LLM loop vs local mocks, discovery API job, red team emulator + sandbox-path pause/continue, divergence disappears after fixes, GitHub PR flow vs mock (draft, base untouched, token not leaked, error sanitised). Browser E2E checks 22–26 cover the UI.
