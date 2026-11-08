# SellerShield AI — 3-Minute Live Demo Script

Everything below was exercised by the E2E suite (`e2e/e2e.js`) on the final build. UI timings: a live run completes in ≈13–15 s. The primary demo needs **no PayPal or AI credentials**.

## Pre-flight (5 minutes before)
1. Start backend (`cd backend && npm start`) and frontend (`cd frontend && npm start`); open http://localhost:3000. Check http://localhost:4000/api/health returns `ok:true`.
2. Click **Explore Live Demo** → on the Live Demo page click **Reset demo** (the E2E suite and earlier practice leave state behind).
3. Browser at 100–110 % zoom, 1440×900 or larger, dark OS theme irrelevant. Close other tabs. Open two tabs: Tab A `/demo`, Tab B `/attack-chains` (not required, a fallback).
4. Do not press Run yet. Expect: stage list with only Stage 1 done.

## 0:00–0:20 — Introduction (Tab A, landing or demo page)
Say: "Imagine an e-commerce platform where an attacker doesn't need to exploit one major vulnerability. Instead, they combine three seemingly harmless weaknesses — a coupon rule, a refund formula and a retry — into a financial attack. SellerShield AI finds those combinations, proves them, fixes them, and remembers."
Show: Live Demo page header; header chips "Controlled sample application", "PayPal: DEMO MODE", "AI: deterministic mode" — say once: "Everything you'll see runs in a local simulator."

## 0:20–0:50 — Six agents
Do: click **Run Live Demo** (button top right).
Expect: Stage 2 shows six agent chips; Stage 3 progress bars fill (Opportunist 4, Refund 3, Payment 5, Insider 2 probes).
Say: "Four investigators — Opportunist for discounts, Refund Abuse, Payment Manipulation, Insider Threat for staff permissions — probe in parallel. The Defence Architect designs fixes and the Auditor verifies. This progress is the real backend job, not an animation."
Expect at ~0:40: Stage 4 lists 6 findings (DISC-001, REFUND-001, REFUND-002, PAY-001, INV-001, ACL-001), "controls held" are not shown here but on Agent Control Center.

## 0:50–1:20 — Compound attack
Expect: Stage 5 "Discount-Stack Refund Siphon" and "Phantom Payment Insider Payout"; Stage 6 steps; Stage 7 numbers $80.00 / -$74.00 / $154.00.
Say: "Alone these cost $34, $20 and $30 — $84. Chained, the merchant collects $126, refunds $200, instead of keeping $80: $154 per attack, simulated. A second chain — a pending payment that ships goods, then an intern refunds money that never arrived — costs $240."
Optional (if on time): sidebar **Attack Chains** → click the Siphon tab → click a red vulnerability node.

## 1:20–1:45 — Independent verification
Do: scroll to Stage 8 (all three show "proposed"/"verified"); optionally open **Agent Control Center** and point to the Auditor's "Audit verdicts".
Say: "A model's claim isn't trusted. The Auditor re-runs each attack from scratch twice, checks ledger rules and recomputes the dollars. In our tests it rejects an inflated claim, an unknown test case, and an attack that no longer reproduces."
Be honest if asked: the forged-claim rejection is shown in the test suite, not a UI button.

## 1:45–2:20 — Patching
Do: Stage 9 → expand **Review 3 patch diffs**. Point at the red/green lines (refund calculation).
Say: "These are real diffs of the rule source. Nothing is applied automatically."
Do: show the **Approve and apply** button is disabled; tick the confirmation checkbox (button enables); click **Approve and apply 3 fixes**.
Expect: green notice "Fixes approved by a human and applied to the demo app."
Say: "Human approval plus an explicit confirmation, demo app only, and rollback is one click in the Defence Center."

## 2:20–2:40 — Attack replay (the WOW)
Do: Stage 10 → **Replay the original attack and run regression tests**.
Expect (≈3 s): green banner "Original compound attack: **FAILED (blocked)** … excess per attack now $0.00 (was $154.00)", three passed defences with ticks: "Legitimate partial refund returns the proportional amount – $80 (expected $80)".
Say: "Same attack, now blocked — and a legitimate partial refund still works."

## 2:40–3:00 — Regression memory
Do: sidebar **Merchant Setup** → *Business rule configuration* → **Allow coupon stacking: On** → sidebar **Attack Memory** → **Rerun previous tests**.
Expect: green notice "Regression run finished: 1 reintroduced…", red box "1 reintroduced vulnerability — DISC-001 Coupon stacking…".
Say (close): "SellerShield AI doesn't just detect today's vulnerabilities. It helps ensure yesterday's vulnerabilities don't silently return tomorrow."
(Afterwards: Merchant Setup → stacking **Off**, or just **Reset demo**.)

## Optional +30 s: "the attacker found one we didn't script"
Do: sidebar **Discovery Lab** -> **Guided search** -> **Run discovery** (about 5 s). Expect: *Not in the scripted library* -> **Cancel-for-Cash: refund of a payment that never settled** - 3 actions, $160 simulated.
Say: "Nobody scripted this. The attacker tried 155,000 action sequences; every one is replayed against a secure baseline before it counts. It is blocked by the payment-state fix."
With a Groq (or Gemini) key configured you can pick **LLM attacker** (a tool-calling LLM agent); **only do this live if you have already seen it succeed** - see docs/LLM_LIVE_VALIDATION.md for what was actually verified.
PayPal: with Sandbox credentials, **PayPal Integration -> Run red team -> PayPal Sandbox** shows real-platform probes (approve the order as the buyer, then Continue). Without credentials it uses the local emulator - **say so** ("emulator, not PayPal").
PR: **Defence Center** -> a verified fix -> **Preview pull request** (with `GITHUB_TOKEN` set, **Open draft pull request**).

## If something is slow or fails
- Run takes >30 s: it is paced by `AGENT_STEP_DELAY_MS` (default 450 ms); talk through the agents' roles while it finishes. Stages update on their own.
- Page shows an error/blank: reload (state is in the DB); if still wrong click **Reset demo** and **Run Live Demo** again (the E2E reset flow does exactly this).
- Backend down: restart `npm start` in `backend/`; no data loss (SQLite file).
- Stage 9 checkbox missing: the run hasn't finished — wait for Stage 8 to show defences.
- Network/projector issue: switch to the **backup**.

## Backup procedure
1. **Screenshots (real captures)** in `docs/screenshots/`, in demo order: `01-demo-running`, `02-agents`, `07-attack-chain-explorer`, `03-patch-diff-and-approval`, `04-attack-blocked`, `11-regression-memory`, `12-report`. Put them in the PPT (`SellerShield_AI_Hackathon.pptx`).
2. **Recorded video:** *not yet recorded.* Record one yourself with Windows Game Bar (Win+G) or OBS following this script on a freshly reset demo (≈2.5 min), and save it as `docs/screenshots/backup-demo.mp4`. Do not present a video as live.
3. **Headless re-run:** `cd e2e && node e2e.js` regenerates all screenshots and prints PASS/FAIL (then Reset demo).


---
# Extended 7-10 minute demonstration (final)
**Before you start:** servers running; Merchant Setup untouched; **Reset demo** (it keeps a pending real Sandbox red-team run); Groq rate limits make the LLM engine slow, so show its stored trace or the screenshot unless you have just run it. Say "live" only for what the validation report marks LIVE VERIFIED.

| Time | Segment | Do / say |
|---|---|---|
| 0:00-1:00 | Problem | Merchants lose money to *combinations* of small logic flaws. SellerShield attacks the merchant's own logic in a simulator and PayPal's protocol, proves it, fixes it, remembers it. Not fraud prediction, not a PayPal product. |
| 1:00-2:30 | Live Demo flow | Live Demo → Run: six agents, six findings, Discount-Stack Refund Siphon ($126 collected, $200 refunded, $154 excess vs $84 isolated). |
| 2:30-4:00 | **PayPal Red Team** | PayPal Integration → Red Team → **PayPal Sandbox**. Show RT-01 and RT-02 (real order id, `ORDER_NOT_APPROVED`) tagged PAYPAL SANDBOX, and the approval link. Say plainly: "phase B needs a human buyer; we pause rather than bypass it." Phase B is complete: select the stored **PayPal Sandbox** run from *Recent runs* and show RT-03 to RT-06 (real capture and refund ids, `ORDER_ALREADY_CAPTURED`, `REFUND_AMOUNT_EXCEEDED`) and the RT-07 divergence: NovaCart would book $200 while PayPal refunded $100. To show a fresh live run you need a new buyer approval; the emulator is a fallback and must be called out as **emulator, not PayPal**. |
| 4:00-6:00 | **Attack Discovery Lab** | Run **Guided search** (about 5 s): *Cancel-for-Cash*, 3 actions, $160 simulated, blocked by `payment-state`. Then show the stored **Groq LLM session**: live trace with rate-limit backoff, 2 verified findings. Explain "$120": for the intern refund the real over-refund is $24; the rest is a refund the secure shop forbids. Known root causes, new paths. |
| 6:00-7:00 | Deterministic verification | Open "Show independent verification": vulnerable vs secure replay, ledger invariant, determinism. "The model's claim is never evidence." |
| 7:00-8:30 | **Defence + PR** | Defence Center: diff, approval, confirmation, apply, replay blocked. Show **Preview pull request** (patch + regression test + report). Say: opened as a *draft*, never merged. **Only claim a real PR if you have one.** |
| 8:30-9:30 | Boundaries + business impact | Simulated figures, human approval, demo-app-only patches, Gemini off, GitHub PR not yet live (PayPal webhook verification is live-verified). Regression memory: re-enable stacking → rerun → reintroduced. |
| 9:30-10:00 | Close | "Security should not stop at detection." |
