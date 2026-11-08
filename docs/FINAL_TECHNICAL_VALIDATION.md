> **Superseded for current status by [FINAL_HACKATHON_VALIDATION.md](FINAL_HACKATHON_VALIDATION.md).** Historical record below.

# Final Technical Validation

Date: 2026-11-08 · Environment: Windows 11, Node v26.13.0, npm 11.20.0, Chrome (headless) via puppeteer-core · SQLite database.
Legend: **PASS** executed and succeeded · **FAIL** executed and failed · **NOT TESTED** never executed · **BLOCKED** could not be executed (reason given).

## 1. Summary
| Area | Result |
|---|---|
| Backend tests (vitest) | **PASS** 82/82 (simulator 41, unit 22, API integration 19) – run 3 times, last after all code changes |
| Backend type-check (`tsc`) | **PASS** |
| Prisma schema validation | **PASS** (SQLite schema) |
| Frontend production build (`next build`) | **PASS** (16 routes) – rebuilt after every frontend change |
| Frontend type-check (`tsc --noEmit`) | **PASS** |
| Frontend lint | **NOT TESTED** – no ESLint configured in the project |
| Frontend automated unit tests | **NOT TESTED** – none exist (browser E2E below is the only frontend test) |
| Browser E2E (21 checks, `e2e/e2e.js`) | **PASS** 21/21 on the final build (final run executed twice) |
| PostgreSQL | **NOT TESTED** (schema + compose exist; no Postgres/Docker daemon available) |
| Real PayPal Sandbox calls / real webhook signature verification | **NOT TESTED** (no credentials) |
| Live AI model calls | **NOT TESTED** (no API key) |
| Production deployment (Render) | **NOT TESTED** (manual Render setup documented in DEPLOYMENT_GUIDE.md, never deployed) |

## 2. Commands executed
```
backend:  npx tsc -p . ; npx vitest run ; npx prisma validate ; npm audit --omit=dev ; npm outdated
frontend: npx next build ; npx tsc --noEmit -p . ; npm audit --omit=dev
runtime:  backend `npx tsx src/server.ts` (:4000), frontend `npx next start -p 3000`
e2e:      cd e2e && npm install && node e2e.js   (results: e2e/results/e2e-results.json)
probes:   curl against http://localhost:4000 only (auth, CORS, rate limit, forged webhook, SQLi-style input)
```
No command was run against any external site or service. Attack scenarios ran only inside the local NovaCart simulator.

## 3. Browser E2E results (all against the local app)
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Homepage loads | PASS | headline + CTA text present |
| 2 | Explore Live Demo | PASS | lands on `/demo` with a session |
| 3 | Run Live Demo | PASS | live assessment started from a clean reset |
| 4 | Six agents execute | PASS | all six names present, all complete |
| 5 | Findings appear | PASS | DISC-001, REFUND-001, REFUND-002, PAY-001, INV-001, ACL-001 |
| 6 | Compound chains appear | PASS | Discount-Stack Refund Siphon; Phantom Payment Insider Payout |
| 7 | Financial exposure | PASS | UI shows $80.00 expected, -$74.00 actual, $154.00 excess |
| 8 | Auditor verification displayed | PASS | "Audit verdicts" with 6 × verified on Agent Control Center |
| 9 | Forged findings rejected | **PASS (unit test only, not browser)** | `tests/simulator.test.ts` "verifies real findings and rejects fabricated ones" (leakage 999 → rejected) |
| 10 | Unreproducible findings rejected | **PASS (unit test only, not browser)** | same test: unknown ID `MADE-UP-9` rejected; finding re-audited after fix → rejected. The UI has no control to inject a forged claim. |
| 11 | Patch diffs display | PASS | `@@` hunks with +/- lines of real rule source |
| 12 | Approval workflow | PASS | "Fixes approved by a human…" |
| 13 | Explicit confirmation required | PASS | Apply button `disabled=true` until checkbox ticked |
| 14 | Patch application | PASS | `coupon-stacking, refund-calc, refund-idempotency` in force (API) |
| 15 | Rollback | PASS | tested on INV-001 via Defence Center: in force after apply, removed after rollback, vulnerability back to `verified` |
| 16 | Original attack blocked | PASS | "FAILED (blocked)", excess per attack now $0.00 |
| 17 | Regression memory | PASS | "Regression run finished" |
| 18 | Reintroduced vulnerability detected | PASS | stacking turned on in Merchant Setup → DISC-001 flagged "1 reintroduced vulnerability" |
| 19 | Reports | PASS | preview, JSON (200) and PDF (200, `%PDF`, ~9 KB) |
| 20 | Navigation | PASS | 12 routes render; 12 sidebar links valid |
| 20c | Responsive (1024 & 768 px) | PASS after fix | no horizontal page overflow on 11 pages |
| 21 | PayPal page self-test (demo mode) | PASS | **local simulation only**; forged webhook rejected, replay ignored |

Network/console review of the final run: the only HTTP ≥400 responses were two intentional 422s from the PayPal self-test's negative cases (capture of an unapproved order; refund above the remaining balance). No unhandled exceptions, no page errors.

## 4. Security review
Probes run against the local backend:
| Check | Result |
|---|---|
| Unauthenticated API access | PASS – 401 |
| Forged/invalid JWT | PASS – 401 |
| CORS | PASS – only `APP_URL` is ever echoed as allowed origin; `Origin: http://evil.example` receives `Access-Control-Allow-Origin: http://localhost:3000`, so browsers block it |
| Security headers (Helmet) | PASS – 4 headers present |
| Rate limiting | PASS – 40 rapid bad logins → 21×401 then 19×429 |
| SQL injection | PASS – Prisma only; no `$queryRaw`/`$executeRaw` in `src/`; SQLi-style email rejected by Zod (400) |
| XSS | PASS (static) – no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; React escapes output |
| Shell execution | PASS (static) – no `child_process`/`exec`/`spawn` in `backend/src` |
| Forged PayPal webhook | PASS – 401, `rejected_unverified`, state unchanged |
| SSRF guard | PASS (unit-tested) – localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.169.254, [::1], metadata hosts, `file:`/`ftp:`, credentials in URL all rejected; **not tested against real DNS rebinding** |
| File uploads | PASS (API-tested) – `.exe`, binary, >1 MB, bad JSON, path-like names rejected; content stored inert |
| Tenant isolation | PASS – second user receives 404 on every demo-merchant resource (API-tested) |
| Role enforcement | PASS – viewer cannot start assessments |
| Hard-coded secrets | PASS – scan found only a fake `sk-…` fixture in a redaction unit test; `backend/.env` contains only `DATABASE_URL` (not printed) |
| Patch boundaries | PASS – apply requires approval + `confirm:true`; only `isDemo` merchants; tested |
| Production secret guard | **added this session** – server refuses to start in `NODE_ENV=production` with a missing/short/default `JWT_SECRET` (verified by running it) |

Dependency audit (`npm audit --omit=dev`) – **not fixed, documented**:
- backend: `zod <4.6.6` (high) and `deepmerge-ts` via `prisma` tooling (high). Fix requires a zod major upgrade and Prisma 7; not done to avoid destabilising a validated build. Input sizes are capped (256 KB JSON) which limits practical impact.
- frontend: `postcss` inside `next` (moderate, source-map path traversal at build time) and a `next` advisory range; fix requires Next 16. Not done.

## 5. Bugs discovered and fixed this session
1. **Layout overflow** – `/defence` overflowed horizontally by ~430 px at 1024/768 px (grid `1fr` track blown out by the diff `<pre>`). Fixed with `minmax(0,1fr)` and `min-w-0` on cards.
2. **Dashboard overflow at 768 px** – 4-column stat grid too tight. Now 2 columns until `xl`.
3. **Stale 404 polling after "Reset demo"** – the demo page kept polling the deleted assessment. Fixed by clearing the id first.
4. **Attack-chain graph unreadable** – nodes rendered at ~50 % zoom beside a side panel. Graph now uses the full width; layout tightened.
5. **Demo showed stale "remaining risks"** after fixes (fixed earlier in this project; re-verified).
6. **Production hardening** – JWT secret guard added (see above).
Test-script issues (not product bugs) found and corrected: case-sensitive heading match, flex-layout newline in text match, and a read-before-render race in check 18.

## 6. Limitations that remain (see `KNOWN_LIMITATIONS.md`)
SQLite only verified; PayPal Sandbox, webhook signature verification against PayPal, and live AI untested; attack simulation only for NovaCart; website mode public-page observation only; uploads not analysed; no frontend unit tests/lint; in-process jobs; dependency advisories above; `@/` import alias replaced with relative imports.

## 7. Notes for presenters
The E2E suite leaves the demo database in a dirty state (some vulnerabilities resolved/reintroduced). **Press "Reset demo" before presenting.**

---
## Addendum 2026-11-08 - Discovery Lab, PayPal Red Team, Defence-as-PR
| Item | Result |
|---|---|
| Backend tests | **PASS 103/103**, run three times consecutively (82 previous + 21 in `features.test.ts`) |
| Backend type-check, frontend type-check, frontend production build (17 routes) | **PASS** |
| Browser E2E | **PASS 26/26** (checks 22-26 added: LLM option disabled without key, Cancel-for-Cash discovered and then eliminated by the fix, red-team results with source labels and divergence, PR preview with disabled "Open" button without GitHub config) |
| Generated PR regression tests executed | **PASS** (4/4 for `coupon-stacking` and `payment-state`) |
| Real PayPal Sandbox calls | **NOT TESTED** (red team validated against a local emulator that models documented behaviour; it is not PayPal) |
| Live LLM calls | **Groq PASS live; Gemini BLOCKED (HTTP 403 billing)**: see `docs/LLM_LIVE_VALIDATION.md`; Anthropic removed |
| Real GitHub PR creation | **NOT TESTED** (validated against a local mock server) |

Bugs found and fixed while building: (1) discovery trace writes could be overwritten by older snapshots (race) - now serialised; (2) the new test file mutated shared demo state and made other test files order-dependent - deterministic reset added; (3) raw search output was 60 near-duplicate findings with misleading titles - now ranked, capped and titled from the violated rules.
A previously unnoticed gap was also closed: a new ledger invariant (*refund-without-settlement*) was added because the discovery search showed a refund of an unsettled payment (Cancel-for-Cash) that no existing invariant flagged; all existing tests still pass.

### Real PayPal Sandbox (credentials supplied by the user, 2026-11-08)
| Item | Result |
|---|---|
| OAuth client-credentials against `api-m.sandbox.paypal.com` | **PASS** (`oauth: ok`) |
| Red team phase A vs real Sandbox: RT-01 idempotent order creation, RT-02 capture-before-approval rejected (HTTP 422 `ORDER_NOT_APPROVED`) | **PASS** |
| Red team phase B (capture / replay / refund / over-refund / reconciliation) | **NOT TESTED live** - needs a human buyer approval at the PayPal link |
| PayPal page order / capture / refund buttons, webhook signature verification | **NOT TESTED live** |
| Browser E2E with credentials present | 26/26 PASS (E2E never creates real Sandbox orders; the red-team check forces the emulator) |
| LLM providers: failover, tool calling, backoff | **LIVE PASS on Groq** (tool calling, 17 real 429s recovered, one real discovery session with 1 verified + 1 rejected attack), **Gemini BLOCKED** (HTTP 403, billing); failure paths MOCK-tested (111 backend tests pass) |
