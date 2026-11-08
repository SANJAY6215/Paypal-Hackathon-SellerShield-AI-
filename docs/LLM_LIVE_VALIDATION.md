# LLM Live Validation: Gemini → Groq failover

Executed 2026-11-08 with the user's own keys from `backend/.env` via `backend/scripts/validate-llm.ts` (`cd backend && npx tsx scripts/validate-llm.ts`). Raw machine-readable results: `docs/llm-live-validation.json` (keys are never printed or stored; error bodies are redacted).
Anthropic/Claude was **removed** from the code, `.env`, templates and docs at the user's request. The chain is now `LLM_PROVIDER_ORDER=gemini,groq`.

**Legend:** **LIVE** = a real HTTP call to the provider's production API. **MOCK** = a local test server, never counted as a live result. **BLOCKED** = could not run live, with the reason.

## Summary
| Provider | Model | Result |
|---|---|---|
| Gemini | `gemini-2.5-flash` | **BLOCKED (live):** every chat call returns HTTP 403: *"The Gemini API free tier is not available for this project. Set up billing…"*. The key authenticates for `GET /models` (61 models listed) but cannot generate. Same 403 for `gemini-2.5-flash` and `gemini-flash-lite-latest`. This is an account/project restriction, not a code problem. Fix: enable billing, or create the key in a different AI Studio project where the free tier is available. |
| Groq | `openai/gpt-oss-120b` | **LIVE PASS:** completions, function calling, discovery session. |

## Results
### Live-verified
| # | Item | Result |
|---|---|---|
| 1 | Environment loading | **LIVE PASS.** `GEMINI_API_KEY` and `GROQ_API_KEY` loaded (presence only checked; values never printed); resolved order `gemini:gemini-2.5-flash`, `groq:openai/gpt-oss-120b`; Anthropic not configured. |
| 2 | Model IDs | **LIVE.** Each provider's `/models` list was fetched. My initial defaults were wrong for these accounts: Groq did not list `llama-3.3-70b-versatile` (HTTP 404) and `gemini-2.0-flash` is not in Gemini's list. Corrected defaults to `openai/gpt-oss-120b` and `gemini-2.5-flash`; both now confirmed present in the live lists. |
| 3 | Real API calls | **LIVE.** Groq: HTTP 200 (note: gpt-oss is a reasoning model; with `max_tokens: 20` it returned empty visible text because reasoning consumed the budget; the app uses ≥600 tokens). Gemini: HTTP 403 (BLOCKED, above). |
| 4 | Tool calling | **LIVE PASS (Groq).** Model requested `add_numbers` with arguments `{"a":2,"b":3}` (parsed, correct), accepted the tool result and its final answer mentioned 5. Gemini: BLOCKED. |
| 4b | Structured responses | **LIVE PASS (Groq, through the app's own helpers).** Tool-call arguments are JSON-parsed and Zod-validated; `askJson` (prompt + Zod) returned a valid object in 978 ms; `askText` returned text. **Not supported:** `response_format: json_object` on `openai/gpt-oss-120b` returned HTTP 400, so the app does not use JSON mode. |
| 5 | Failover | **LIVE PASS.** (a) Real Gemini rejecting a deliberately invalid key (HTTP 400) → real Groq answered. (b) With the real Gemini key: real HTTP 403 → failover → Groq completed the entire discovery session. The circuit breaker now skips a provider after a 401/403 for 10 min (429: 60 s). |
| 6a | Timeout handling | **LIVE PASS.** Client-side abort (1 ms limit) against the live Gemini endpoint → `timeout` ProviderError, failover-eligible. |
| 6b | Rate-limit handling | **LIVE PASS (observed, not forced).** The Groq free tier returned **17 real HTTP 429s** during the final discovery session. The backoff (honours `retry-after`/"try again in", waits up to 65 s, retries the same provider up to 5 times, fails over only if asked to wait longer) recovered from every one. In the first live attempt, before backoff existed, a 429 caused the provider to be abandoned, which is why backoff was added. |
| 7 | Real LLM discovery session | **LIVE.** Groq `openai/gpt-oss-120b`, 2 attempts, 18 model turns, 122.6 s wall time (dominated by rate-limit waits), 47 HTTP calls overall in the validation run, 29,552 tokens total (23 HTTP 200 / 17 Groq 429 / 4 Gemini 403 / 1 Gemini 400 invalid-key test / 1 Gemini abort). Groq successful-call latency min 358 ms, avg 1,301 ms, max 2,425 ms. |
| 8 | Independent verification of discovered attacks | **LIVE inputs, deterministic checks.** Every LLM-proposed sequence is replayed on the vulnerable shop and a fully-secure shop (see below). |
| 9 | Provider/model/latency/tokens/errors | Recorded per call in `docs/llm-live-validation.json` (`calls[]`). |

### The live discovery findings (final run)
| Attempt | Outcome |
|---|---|
| 1 | **VERIFIED: "Over-refund Headset"**: create order NC-HEADSET with SAVE20 (paid $96) → payment COMPLETED → admin refund of 1 unit. Vulnerable shop refunded the **$120 list price**; secure shop's position 0 vs vulnerable −24 → **$24 excess** (simulated). Ledger invariants violated: over-refund, refund-allocation, refund-without-settlement. Re-verified independently (`reverified: true`). Blocked by `refund-calc` (root cause) or `refund-permission`. |
| 2 | **REJECTED by verification:** the model tried cancel/refund/coupon-edit variations but they produced no loss beyond what the secure baseline already allowed (check "replay loses more money than secure baseline" and "ledger invariant violated" failed). |

**Honest caveats about these findings**
- The LLM re-found a **known root cause** (list-price refunds, scripted as REFUND-001). The "novel" tag means *the violation pattern is not produced by any single scripted scenario*, not that it is a new class of weakness. The guided search's *Cancel-for-Cash* remains the best example of a path outside the scripted library.
- **A scoring bug was found by this validation and fixed.** The first live session reported two findings with "$120 excess" each. Checking them showed the secure baseline was also rejecting the refund for a *procedural* reason (the model supplied no idempotency key), inflating the loss (the true over-refund was $24). Refunds without an idempotency key are now given a unique one before replay (`normalizeActions`); approval/role rules are deliberately not normalised. A regression test covers it.
- One live run per provider is not a benchmark. LLM output is non-deterministic; a free `gpt-oss-120b` session found one real, minor attack in two attempts.

### Mock-tested only (NOT live)
All in `backend/tests/failover.test.ts` and `features.test.ts` against local servers: 429 → failover when retries are exhausted; 429 with `retry-after` honoured with exact waits; very long `retry-after` → immediate failover; 401 key rejection → failover and the failed provider is skipped later; 500 / all providers down reported honestly (no invented findings); malformed JSON tool arguments and unknown tool names rejected without execution; hallucinated attack rejected; latency/token accounting; keys never appear in traces or API responses; provider order from environment.
**Never run live:** Gemini success path (blocked by billing), Gemini tool calling, HTTP 5xx from a live provider, all-providers-down against live services, malformed tool arguments from a live model.

## Findings summary
1. Gemini is unusable with the current key until billing/another project is configured; failover correctly routes to Groq.
2. Defaults I had guessed were wrong; corrected from the providers' live model lists.
3. Groq's free tier rate-limits aggressively (17 × 429); backoff makes sessions complete but slowly (≈2 minutes).
4. Live validation exposed and fixed an inflated-loss scoring bug.
5. Live assessments now also call the AI helpers (hypothesis ordering, explanations). With the circuit breaker, a blocked Gemini costs one failed call per ten minutes; Groq rate limits can make those helpers fall back to the deterministic planner, which is the designed behaviour.

## Addendum (final pass, 2026-11-08)
- **Gemini is now disabled by default** (`GEMINI_ENABLED` must be `true`), so the app no longer spends a request on a known-403 provider. The active chain is **Groq → deterministic fallback**.
- **Second real discovery session, through the real UI → API → database** (not the harness): Groq `openai/gpt-oss-120b`, 18 model turns, no failover, repeated 429s recovered by backoff, **2 findings independently verified** (admin sets coupon to 100% then a list-price refund pays $120 on a $0 order; intern refunds the $120 list price of a $96 order). Both are known root causes (`refund-calc`, `refund-permission`); the model did **not** repeat the earlier $24 "Over-refund Headset" finding, which shows non-determinism. Evidence: `docs/screenshots/final/LIVE-discovery-groq-llm-session*.png`.
- The Groq tool-calling and structured-output checks were **not repeated** in this pass (to conserve free-tier quota); their results above are from the earlier run today.
