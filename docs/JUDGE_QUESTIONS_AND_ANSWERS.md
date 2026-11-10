# Judge Q&A — SellerShield AI

Format: **Short** (say this live) · **Deeper** (technical backup). Everything is checked against the code as of 2026-11-08. Untested items are marked ⚠ **not tested**.

Key numbers to remember: 6 agents · 13 scenarios (6 reproduce on NovaCart, 7 hold) · 2 verified chains · Siphon $154/attack vs $84 isolated · Phantom $240 vs $210 · 82 backend tests · 21 browser checks.

---
## A. Innovation and uniqueness
**1. What makes SellerShield AI innovative?**
Short: It chains weaknesses into one proven financial attack, has an independent auditor reproduce every claim, ships a real diff, and remembers fixed issues so regressions are caught.
Deeper: The pieces exist separately in the world; the contribution is the closed loop — discover → chain → verify → patch → replay → remember — running on a deterministic simulator so every number is reproducible.

**2. How is it different from traditional vulnerability scanners?**
Short: Scanners typically inspect isolated technical issues; we model *business-logic* sequences and prove the dollar impact in a simulator.
Deeper: We don't claim what any specific product does. Our difference is scope (commerce rules: discounts, refunds, payment states, roles) and the evidence model (ledger invariants + secure-baseline comparison). Limitation: it only tests a modelled app (NovaCart), not arbitrary live sites.

**3. Why is compound attack detection important?**
Short: Because the loss comes from the interaction. Separately $84, chained $154.
Deeper: DISC-001 shrinks what was paid; REFUND-001 refunds list price, so the gap grows; REFUND-002 pays it twice. `chains.ts` encodes the edges and executes the path; the chain must leak ≥ its worst single node to be verified.

**4. What is the biggest innovation?**
Short: Verification before trust, plus attack memory — an AI claim becomes "verified" only after deterministic reproduction.
Deeper: `auditFinding` runs the scenario twice from fresh state, checks invariants, recomputes exposure from the ledger, and can disagree with agents (tests prove rejections).

**5. Why should an e-commerce business use it?**
Short: To find money-losing logic flaws before customers or insiders do, with a fix and proof.
Deeper: Today it is a prototype for a modelled shop; a real merchant would need adapters for their platform (not built). Be upfront about that.

## B. Technical architecture
**6. Why six agents?**
Short: Four attacker perspectives, one builder, one independent checker — separation of duties.
Deeper: The investigators own disjoint scenario sets (`agents.ts`), the Defence Architect never sees unverified claims, and the Auditor is separate from the claimants, so it can overrule them. Six is a design choice, not a magic number; they are roles over one scenario library.

**7. How do the agents communicate?**
Short: Through the orchestrator and the database, with Zod-validated structured outputs.
Deeper: Agents return `AgentOutput` JSON; the orchestrator merges claims by test-case ID, hands them to the Auditor, then verified IDs to the Defence Architect. Progress is persisted in `AgentRun`. No free-form agent-to-agent chat.

**8. How is the compound attack graph built?**
Short: A small relationship model links verified weaknesses; we search paths and execute them.
Deeper: `EDGES` (DISC-001→REFUND-001→REFUND-002; PAY-001→ACL-001), DFS over *verified* IDs only → candidate paths → `runChain` plays the sequence in a fresh `Shop`. The edge table is hand-authored today (⚠ not learned).

**9. How is financial exposure calculated?**
Short: Excess per simulated attack × projected number of exploited orders, shown as low/expected/high with assumptions.
Deeper: `finance.ts`: attacks = 1,200 orders × 12 months × exploitation rate (e.g. refund 0.05% / 0.2% / 0.6%); exposure = attacks × excess. Excess is measured vs a fully secure baseline run. Each order counts once; replays are inside the per-attack figure. Rates are assumptions → labelled "SIMULATED PROJECTION", confidence "medium".

**10. What if two agents disagree?**
Short: The Auditor decides; it can reject or correct severity.
Deeper: Current agents don't overlap, so same-ID conflicts don't occur; duplicates merge. Real conflict handling would matter once agents share scope — not implemented.

## C. AI and verification
**11. How do you prevent hallucinations?**
Short: The model can't execute or create findings; only deterministic code can, and the Auditor re-checks.
Deeper: LLM output (if enabled) is limited to scenario IDs/rationales, Zod-validated; unknown IDs are rejected. Findings come from `scenario.reproduce`. ⚠ Live LLM path not tested.

**12. What is the Independent Auditor?**
Short: An agent whose only job is to reproduce and challenge claims.
Deeper: It reuses the simulator but verifies via ledger invariants (`auditLedger`) and a separate oracle (`oracleLeakage`) rather than the scenario's own result.

**13. How does the Auditor verify?**
Short: Two fresh reproductions, invariant checks, dollar recomputation, severity check.
Deeper: Hard checks: reproduction #1 and #2 identical; ≥1 invariant violated; |oracle − claim| ≤ $0.01. Severity mismatch → corrected with a note. Chains: re-execute, deterministic, leakage ≥ max isolated.

**14. Can an attacker manipulate the agents?**
Short: Limited surface: agents run fixed probes; the model only reorders them.
Deeper: Remaining surface: merchant text placed in the prompt (secrets/emails redacted). Uploaded docs are not fed to the model today. Risk would grow if free-form docs drove analysis.

**15. What happens when the AI model is unavailable?**
Short: Everything still works — deterministic planner and template explanations; the UI says "deterministic mode".
Deeper: `getProvider()` returns null without a key; `askJson/askText` return null on any error/timeout; the pipeline falls back.

**16. Why a deterministic fallback?**
Short: Reliability and reproducibility — judges and CI get identical results.
Deeper: Also keeps verification independent of model behaviour. It means the demo is *not* evidence of LLM capability.

## D. Security and patching
**17. How do you generate actual patches?**
Short: We diff the vulnerable and secure implementations of each rule in the repo.
Deeper: `buildPatch` extracts the source of paired functions from `rules.ts` and creates a unified diff. The LLM only writes the explanation.

**18. How do you ensure patches are safe?**
Short: Verified before and after: attack blocked, legitimate flows pass, no new exploit in other scenarios.
Deeper: `verifyFix` runs original attack before/after, per-fix legit checks, 12 other scenarios for regressions, and chain checks. Applies only to the simulated app.

**19. Why require human approval?**
Short: Automated changes to money logic must be reviewed.
Deeper: API enforces `approved` status and `confirm:true`; tests assert 409/400 for shortcuts; viewers can't act.

**20. What if a patch breaks the application?**
Short: Verification should catch it; otherwise roll back.
Deeper: Legit-flow tests are the guard; a failure marks the defence `failed`. In the sample app, rollback is instant. For real code we'd need the customer's CI. ⚠ Not applicable to real repos yet.

**21. How does rollback work?**
Short: One click removes the fix from the app state and reopens the vulnerability.
Deeper: `rollbackDefence` removes the fix id from `DemoAppState`, sets status `rolled_back`, vulnerability → `verified`, re-evaluates chains. History snapshots are stored. E2E-tested on INV-001.

**22. Can it modify production websites automatically?**
Short: No. There is no code path that touches a real site.
Deeper: Apply requires `merchant.isDemo`; otherwise the API returns 422 and offers a patch download. Website mode only GETs public pages.

**23. How do you prevent unauthorized patch application?**
Short: Login, role check, ownership check, approval state, confirmation flag.
Deeper: `requireAuth` → `requireRole(admin|analyst)` → `ownDefence` (tenant check) → status gate → `confirm:true`; actions audit-logged.

## E. Regression memory
**24. What is regression memory?**
Short: A per-merchant store of vulnerabilities, attack sequences, fixes and test results.
Deeper: `Vulnerability` (unique per merchant+test case), `AttackChain`, `Defence`, `RegressionTest`, `AttackMemory` events.

**25. How does it identify a reintroduced vulnerability?**
Short: It reruns the saved attack against the current configuration; if a previously fixed one works again it's flagged.
Deeper: Effective fixes = applied fixes minus those disabled by config (e.g. `stackableCoupons:true` removes `coupon-stacking`). Regression mode reproduces every stored scenario; fixed/resolved + reproduces ⇒ `reintroduced`, and the stale defence is marked `failed`.

**26. How is that different from ordinary regression testing?**
Short: The tests are generated from verified attacks and are tied to business-rule config changes and to chains, not hand-written.
Deeper: Honest caveat: conceptually it is regression testing; the novelty is automatic derivation from proven attacks and lifecycle tracking.

## F. Business and scalability
**27. Target customers?**
Short: Small/mid online sellers and platform risk teams who can't staff logic-security reviews.
Deeper: Hypothesis only; no customer validation done.

**28. How could it become SaaS?**
Short: Per-tenant workspaces, platform connectors, scheduled scans.
Deeper: Multi-tenancy by owner already exists; needs Postgres, queue workers, connectors, billing.

**29. Support different e-commerce platforms?**
Short: Write platform adapters that expose the same business-rule interface to the simulator.
Deeper: Not built. Today rules are paired TypeScript functions in a sample app; real platforms need modelling or sandbox access.

**30. Thousands of sellers?**
Short: Not as built — in-process jobs and SQLite.
Deeper: Move to PostgreSQL (⚠ not tested), Redis/BullMQ workers, per-tenant limits, cache static scenario runs.

**31. Monetization?**
Short: Subscription by merchants/scans, plus enterprise rule packs.
Deeper: Idea only; no pricing research done.

## G. Implementation and limitations
**32. Why SQLite instead of PostgreSQL?**
Short: Zero-setup and verifiable on the machine we had; Postgres is prepared but untested.
Deeper: No Docker daemon/Postgres was available. Same Prisma models; `schema.postgres.prisma` exists. ⚠ not tested.

**33. Is real PayPal integration tested?**
Short: Mostly yes. Against real PayPal Sandbox we ran OAuth, order creation with idempotency, capture-before-approval rejection, a human-approved capture, capture replay, duplicate capture rejection, refund, refund replay and over-refund rejection. Webhook signature verification has not been run live yet.
Deeper: OAuth, Orders, capture, refund and `verify-webhook-signature` have run against PayPal Sandbox (the webhook on 3 real deliveries, 2026-11-08; a real Resend was delivered and not stored twice, response body not captured). What *is* tested: our dedupe, unverified-event rejection, capture-state rules, idempotency, in demo mode.

**34. Is live AI tested?**
Short: No.
Deeper: ⚠ All runs used the deterministic path. The provider code and Zod validation exist.

**35. Can you analyze any public website?**
Short: We can read public pages (SSRF-safe) and report observations; we can't test hidden logic.
Deeper: Crawl up to 7 same-origin pages; extracts refund/cancellation/shipping/discount text, prices, contacts. It never attacks, logs in, or bypasses controls. The unit test uses a fake fetcher; ⚠ not run against real sites.

**36. Current limitations?**
Short: See `KNOWN_LIMITATIONS.md`: modelled shop only, untested integrations, in-process jobs, dependency advisories.

**37. What next?**
Short: Test Postgres/PayPal Sandbox/live AI, add a second simulated app and a Shopify-style adapter, queue workers, frontend tests.

---
## 10 difficult follow-ups
1. *If the simulator and the vulnerable code are both yours, isn't verification circular?* — Yes for NovaCart; the Auditor guards against agent error, not against a wrong simulator. The simulator is the trust anchor; for real merchants it must be validated against their behaviour.
2. *Edges are hand-written; where's the "discovery"?* — Candidate paths are generated from verified findings, but relationships are curated. Learning edges is future work.
3. *Why are the exposure rates what they are?* — Assumptions for a demo profile (1,200 orders/month); labelled projections.
4. *Why is the e-check scenario realistic?* — PayPal documents pending captures; our model of treating PENDING as paid is a common bug class, but the NovaCart flow is simplified.
5. *Does the Auditor ever disagree in practice?* — In the demo all six are verified; disagreement is demonstrated in tests (inflated claim, unknown ID, post-fix replay).
6. *What if the secure variant is also wrong?* — Legit-flow checks and the ledger invariants constrain it, but they're written by us; independent review needed.
7. *How do you handle partially-fixed chains?* — Chains stay `verified` until every exploitable path is closed; E2E/API tests show Siphon is `mitigated` only after all three fixes.
8. *What stops fix A re-opening B?* — Regression suite runs 12 other scenarios per fix (no *new* exploit allowed).
9. *Concurrency realism?* — INV-001 models a check-then-act race deterministically, not real parallel execution.
10. *Is "autonomous" accurate?* — Orchestration is autonomous; discovery is bounded to a scenario library and patching needs human approval by design.

## 5 novelty challenges
1. *Isn't this just a test suite?* — Largely deterministic tests, plus chain search, auditor, diff generation and lifecycle; novelty is the integration, not any single technique.
2. *Why not just write unit tests for refunds?* — You should; this finds interaction effects and tracks them over config changes.
3. *Where's the AI?* — Optional and bounded (⚠ untested live). We deliberately keep verification deterministic.
4. *Existing business-logic fuzzers?* — We don't compare against specific products; we haven't benchmarked.
5. *Is the chain engine more than hard-coded demos?* — Paths are computed from verified IDs and edges, but the scenario library and edges are fixed.

## 5 questions about SellerShield's own security
1. *Demo login gives admin?* — Yes, when `DEMO_MODE=true`; disable it in production.
2. *Is the JWT secret safe?* — Prod startup is blocked without a strong secret; dev default exists.
3. *SSRF?* — Scheme/host/IP checks incl. connect-time DNS validation and redirects; ⚠ not tested against live rebinding.
4. *Dependency vulnerabilities?* — `npm audit` flags zod/prisma-tooling/next-postcss; not upgraded yet.
5. *Can a malicious upload run?* — No: allow-listed text only, stored inert, never executed or sent to the model.

## 5 real-world deployment questions
1. *Multiple instances?* — Not with SQLite or in-process jobs; needs Postgres + queue.
2. *How do you test a merchant's real checkout?* — Not possible today; needs a sandbox environment or adapter.
3. *Data privacy?* — Only demo data; prompts are redacted; a real deployment needs retention policy and encryption review.
4. *PayPal webhooks in production?* — Needs the verified-signature path tested with Sandbox first.
5. *Cost control for AI?* — Call budget (12/assessment), token cap, timeouts; deterministic fallback.

---
## H. New features (Discovery Lab, PayPal Red Team, Defence-as-PR)
**38. What did you add that is genuinely agentic?**
Short: An attacker that invents action sequences (LLM tool-use or exhaustive search) which deterministic code then verifies against a secure baseline.
Deeper: `discovery.ts`. The LLM engine is a real Messages-API tool-use loop; ⚠ tested only against a local mock of the API. The search engine needs no AI and found *Cancel-for-Cash*.

**39. Did the AI find something you didn't script?**
Short: The guided search did (Cancel-for-Cash, $160). Whether a live LLM finds new things is untested.
Deeper: Cancel-for-Cash is a new *path* to PAY-001's root cause (`payment-state`): pending -> marked paid -> cancel -> refund of unsettled money. It led us to add a ledger invariant (*refund-without-settlement*).

**40. How is PayPal central now?**
Short: The red team attacks PayPal's Orders/Payments protocol, replays our money flow against PayPal refund records, and reconciles our ledger with PayPal's.
Deeper: Real Sandbox needs credentials and a human buyer approval; ⚠ not run live. The default is a local emulator clearly labelled "not PayPal" - its results say nothing about PayPal.

**41. What does reconciliation reveal?**
Short: PayPal would cap the platform payout at the capture amount, but NovaCart's own logic books $200; the defence belongs in the merchant's refund code.
Deeper: RT-07: NovaCart $200 vs PayPal $100 -> divergence $100 (disappears once `refund-calc` and `refund-idempotency` are applied).

**42. Could the LLM attacker hurt anything?**
Short: No: it only drives a simulated shop through a Zod-validated tool set; no shell or network; bounded turns and actions.
Deeper: Claims are never trusted; replay + invariants + determinism decide. Hallucinated and invalid calls are rejected (tested).

**43. Can SellerShield push code to my repo?**
Short: Only a draft PR on a new branch, after verification, approval, role check and explicit confirmation. It never merges or touches the base branch.
Deeper: `github.ts`; ⚠ tested against a local GitHub mock; the token is never returned or logged; use a fine-grained token limited to one repo.

**44. Is the emulator a form of faking PayPal?**
Short: It is a test double, labelled everywhere; it only proves our client and logic work, not PayPal's behaviour.
Deeper: Every result has a `source` tag; the UI shows "EMULATOR - NOT PAYPAL"; real-Sandbox results are tagged `paypal-sandbox`.

**45. What if a free LLM key fails or is rate-limited mid-demo?**
Short: The attacker automatically fails over (Gemini → Groq), and the guided search needs no key at all.
Deeper: `llmAttacker` skips a failed provider for the rest of the run and restarts the attempt on the next; failovers are shown in the trace. Verified live: real Gemini 403 → Groq completed a real discovery session, and 17 real Groq 429s were recovered by backoff; 500/401/malformed-call paths are mock-tested only. Gemini itself is blocked by a billing restriction on the project.

---
## I. Direct answers to the likely judge questions (final, honest versions)
**How is SellerShield different from traditional fraud detection?** Fraud detection scores transactions from outside; SellerShield attacks the merchant's *own business logic* (discounts, refunds, payment states, permissions) in a simulator and proves the dollar impact, then verifies a fix. It does not predict fraud.
**How does the discovery engine find unknown attack sequences?** Two ways: an exhaustive search over ~155k short action sequences (no AI; found *Cancel-for-Cash*), and an LLM that calls shop tools to improvise sequences. Both feed the same deterministic verifier. "Unknown" means outside the scripted scenarios, and the LLM found known root causes via new paths.
**How do you verify an AI-generated attack?** Replay on the vulnerable shop and a fully secure baseline, compare money, require a violated ledger invariant, replay twice for determinism, cap length. The model's own claim is never evidence; hallucinated attacks are rejected (tested, and one live attempt produced no valid loss).
**Why deterministic validation alongside AI?** LLMs hallucinate and vary run to run (our two live sessions found different attacks). Deterministic replay makes every accepted finding reproducible.
**How do you avoid false positives?** Strict baseline, invariants, determinism check, and procedural normalisation (a missing idempotency key does not count as loss). Remaining caveat: "excess" can include refunds the secure shop forbids by policy (e.g. an intern refund), which is a violation, not only extra money.
**Why not prevent attacks instead of only detecting them?** The product does both for its scope: it generates the preventive patch, a regression test and a draft PR (opened for real once, in a dedicated test repo), then replays the attack to show it is blocked.
**How is the generated PR verified?** Before the PR: attack blocked, legitimate flows pass, no new exploit, human approval. After creation the app re-reads the PR from GitHub (draft, branches, files, test present, not merged). **Run once against real GitHub (2026-11-10): the draft PR was checked via the GitHub API (open, draft, not merged, base untouched, 3 files); the app's own re-read result was not captured.**
**What if the LLM API fails?** Rate limits: wait and retry (live-observed). Key errors/outages: provider skipped; if none are left the LLM engine reports failure and the deterministic search remains available.
**What if PayPal is unavailable?** The app falls back to a clearly labelled local simulation; the red team refuses to run against anything but Sandbox.
**Can it work without paid AI APIs?** Yes: the guided search, simulator, auditor, patches and reports need no AI; Groq's free tier powers the LLM engine (slowly, rate-limited).
**What is genuinely live-tested versus simulated?** See `FINAL_HACKATHON_VALIDATION.md` §4: live = PayPal OAuth, the red-team probes RT-01..RT-07 and webhook signature verification on 3 deliveries, Groq tool calling / structured output / two discovery sessions. Simulated/mocked = shop attacks (simulator), capture/refund (emulator only so far), local webhook tests RT-08/RT-09, Gemini blocked. The GitHub draft PR is live-verified once (dedicated test repo).
