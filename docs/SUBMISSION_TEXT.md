# Submission text (copy into the hackathon form)

Fill the bracketed placeholders yourself. Licence: MIT. Everything else is checked against `FINAL_HACKATHON_VALIDATION.md`.

## Project name
SellerShield AI

## Text description (features and functionality)
SellerShield AI is a merchant-side security testing platform for online sellers who take PayPal payments. It finds the money-losing *combinations* of small logic flaws (a coupon rule + a refund formula + a retry) that isolated checks miss, proves them, and helps fix them.

- **PayPal Red Team:** an automated attacker that probes the PayPal Orders and Payments APIs in the **real PayPal Sandbox** (idempotency, capture before approval, capture replay, duplicate capture, refund replay, over-refund) and reconciles the shop's own ledger against PayPal's refund records. In our live run PayPal enforced every protection, but the reconciliation exposed a **$100 accounting divergence**: PayPal capped the payout at $100 while the shop's refund logic would have booked $200. The fix belongs in the merchant's refund code.
- **Attack Discovery Lab:** an exhaustive search (about 155,000 action sequences, no AI) and an **LLM tool-use attacker (Groq)** invent attack sequences against a simulated shop. Nothing the model says is trusted: every sequence is replayed on the vulnerable shop and a fully secure baseline, checked against ledger invariants and replayed twice for determinism. The search found *Cancel-for-Cash*, a path outside the scripted scenarios.
- **Six specialised agents + independent Auditor, compound attack chains** (e.g. "Discount-Stack Refund Siphon": $126 collected, $200 refunded, $154 excess per attack, versus $84 if exploited separately), **financial exposure model** (clearly labelled simulated projections), **patch generation as real code diffs** with human approval, explicit confirmation, rollback, regression tests and **regression memory** that flags a fixed vulnerability that returns.
- **Defence as Pull Request:** a verified, approved fix is packaged as a patch, a runnable regression test and an evidence report for a **draft** GitHub PR (never merged automatically). *Status: implemented and tested against a mock; a real PR has not been created yet.*

## How PayPal is used
PayPal REST APIs in the Sandbox: OAuth 2.0 client credentials, Orders v2 (create, approve by a human buyer, capture), Payments v2 (refund, refund lookup), `PayPal-Request-Id` idempotency, and webhook signature verification via `verify-webhook-signature` (**verified live on 3 real Sandbox deliveries; real redelivery/duplicate not tested**).

## Tools used and how
| Tool | How it is used |
|---|---|
| **PayPal Sandbox REST APIs** | Live payment-protocol probes and reconciliation (verified live) |
| **Groq (`openai/gpt-oss-120b`, OpenAI-compatible API)** | The LLM attacker (function calling), prompt-and-Zod helpers for agent planning and defence explanations; **live-verified**. Deterministic fallback when unavailable |
| Google Gemini | Integrated but **disabled by default** (the project's free tier returned HTTP 403, billing required); not used |
| GitHub REST API | Draft-PR creation (**mock-tested only so far**) |
| Next.js, React Flow, Recharts, Express, TypeScript, Prisma/SQLite, Zod | Application stack |

## Licence
MIT (see `LICENSE`, Copyright (c) 2026 Sanjay B.)

## Functional demo
Setup and run instructions: `README.md` and `docs/INSTALLATION_GUIDE.md`. No credentials are needed for the main demo (it runs on a local simulator); optional PayPal Sandbox and Groq keys unlock the live paths. [Optional hosted demo URL: none yet.]

## Honest limitations
Simulation covers the built-in NovaCart shop only; real GitHub PR creation is not yet verified live; Gemini is disabled; dollar figures are simulated projections.

## Links
Repository: [public GitHub URL] · Video: [YouTube URL] · Team: [names]
