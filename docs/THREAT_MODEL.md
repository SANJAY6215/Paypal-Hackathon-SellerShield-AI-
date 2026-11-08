# Threat Model

Two views: (A) threats the product *simulates* for merchants, and (B) threats *against SellerShield itself*.

## A. Simulated merchant threats (NovaCart)
| ID | Weakness | Business impact (simulated, per attack) | Fix |
|---|---|---|---|
| DISC-001 | Coupon stacking (policy: 1 per order) | $34 | `coupon-stacking` |
| REFUND-001 | Partial refund at list price | $20 | `refund-calc` |
| REFUND-002 | Replayed refund request pays twice | $30 | `refund-idempotency` |
| PAY-001 | Pending payment treated as paid; goods ship, payment later denied | $90 | `payment-state` |
| INV-001 | Concurrent checkout oversells 3 units | $360 | `inventory-race` |
| ACL-001 | Any staff role refunds without approval/audit | $120 | `refund-permission` |
Compound: Discount-Stack Refund Siphon (DISC-001→REFUND-001→REFUND-002) $154; Phantom Payment Insider Payout (PAY-001→ACL-001) $240. Controls that hold: duplicate/expired coupons, negative quantity, refund after cancel, duplicate order, webhook replay, restock on cancel, admin-only coupon edits.
Out of scope: real payment fraud, account takeover, card data, infrastructure attacks.

## B. Threats against SellerShield
Assets: user sessions, merchant data, uploaded documents, PayPal/AI credentials (env only), patch-apply capability, integrity of verification results.
| Threat | Mitigation in place | Residual risk |
|---|---|---|
| Unauthenticated access | session required on all but health/auth/webhook | demo login is intentionally unauthenticated when `DEMO_MODE=true` and grants an **admin** demo account → disable in production |
| Cross-tenant access | every resource checked against merchant owner (tested) | none known |
| Privilege misuse | roles; viewer cannot mutate | only three coarse roles |
| Brute force | 30 req/min on auth routes, 600/min global | per-IP only; behind a proxy `trust proxy` is set to 1 |
| Forged PayPal webhook | verification required; unverified stored, not processed; unique event ids | PayPal verification path untested live |
| SSRF via website mode | scheme/host/IP checks, connect-time DNS validation, redirect revalidation, size/time caps | relies on Node `lookup`; not tested against live rebinding; response parsing by cheerio |
| Malicious upload | allow-list, 1 MB, UTF-8, never executed | stored text could contain prompt-injection text — it is not fed to the LLM today |
| Prompt injection / agent manipulation | LLM output limited to scenario IDs, Zod-validated; deterministic code executes and verifies | merchant-supplied profile text is placed in the prompt (redacted for secrets only) |
| Malicious patch | patches are generated from repository source, never from model output; need approval + confirm; demo app only; rollback | applying a fix mutates the *simulated* app state; there is no real code deployment |
| Tampering with verification | Auditor recomputes independently of agents | simulator code itself is the trust anchor |
| Secret leakage | env-only; `.gitignore` excludes `.env`; audit log excludes secrets; prompt redaction | `JWT_SECRET` default in dev; production start is blocked without a strong one |
| Dependency vulnerabilities | none auto-fixed | see `FINAL_TECHNICAL_VALIDATION.md` §4 |
| Denial of service | body-size limits, rate limits, response caps | in-process job execution; no queue |
| XSS/SQLi | React escaping; Prisma parameterisation | no CSP tuning beyond Helmet defaults |
| LLM attacker abuse (Discovery Lab) | actions limited to a Zod-validated tool schema over a simulator; no shell/network; at most 12 actions, 14 turns, 30 s timeout per call; trace redacted | cost per run if a key is configured; prompt is fixed text |
| GitHub token misuse (Defence-as-PR) | opens only *draft* PRs on a new branch; needs verified + approved defence + role + explicit confirm; token read from env, never returned/logged (tested) | a token with broad scope could be abused by a compromised server; use a fine-grained token limited to one repo |
| Unauthenticated PayPal emulator | non-production only by default; stores no secrets | do not expose a dev instance publicly |
| Red team against real Sandbox | refuses non-"sandbox" URLs; Sandbox only; needs human buyer approval | none known |
| Public placeholder JWT secret | **Found and fixed (2026-11-08):** `JWT_SECRET` equalled the placeholder from `.env.example`; replaced with a random value; old-secret tokens now rejected (tested). Production start already refuses weak/placeholder secrets | dev/demo deployments must still set a real secret |
| Secrets in a cloud-synced folder | project lives in OneDrive, so `.env` (and a deleted `.env.backup`) may exist in cloud history/recycle bin | move the project out of OneDrive or exclude `.env`; delete cloud copies; rotate keys |
| Compromised GitHub token (pasted in chat) | not used by the app; owner must revoke | revocation unconfirmed |
