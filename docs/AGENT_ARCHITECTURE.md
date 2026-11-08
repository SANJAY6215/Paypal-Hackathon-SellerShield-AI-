# Agent Architecture

All six agents are defined in `backend/src/agents.ts` (`AGENT_DEFS`) and orchestrated in `backend/src/orchestrator.ts`. **Agents are not autonomous LLM loops.** Four investigators run deterministic probes from a scenario library; an LLM, when configured, may only *re-order* probes or propose scenario IDs (unknown IDs are rejected). Without an AI key a deterministic planner is used and the UI says so.

| # | Agent | Responsibility | Input | Output | Hands off to |
|---|---|---|---|---|---|
| 1 | Opportunist | discounts, coupons, pricing (DISC-001..003, BIZ-001) | merchant profile + applied fixes | Zod-validated `AgentOutput`: findings + "controls held" | Orchestrator → Auditor |
| 2 | Refund Abuse | refunds, cancellations (REFUND-001..003) | same | same | same |
| 3 | Payment Manipulation | payment state, idempotency, webhook replay, concurrent checkout (PAY-001..003, INV-001..002) | same | same | same |
| 4 | Insider Threat | role separation, approvals, audit (ACL-001..002) | same | same | same |
| 5 | Defence Architect | root cause, diff, plan, trade-offs for each *verified* vulnerability; sandbox dry-run | verified vulnerabilities | `Defence` rows (status `proposed`) | Human approval |
| 6 | Independent Auditor | verifies claims and chains; validates defence dry-runs | claims, chain runs, defences | verdicts (`verified`/`rejected` + checks) | Database |

Each probe results in either a *finding* (exploit reproduced, with step-by-step evidence and simulated leakage) or a *control held* entry. Of 13 library scenarios, 6 reproduce on NovaCart; 7 are secure.

## Interaction sequence
1. Investigators 1–4 run in parallel and persist progress (`AgentRun.progressDone/Total`, task, history log).
2. The orchestrator merges claims by test-case ID and generates chain candidates (`generateCandidates`) from edges between claimed vulnerabilities.
3. The **Auditor** (agent 6) runs `auditFinding` per claim: reproduce twice from fresh state and require identical outcomes, check ledger invariants (`auditLedger`), recompute exposure from the ledger (±$0.01), compare severity (may correct it). Chains are re-executed and must leak at least as much as their worst single node.
4. Only `verified` claims are saved as verified vulnerabilities / chains; `rejected` claims are stored with status `rejected`.
5. The **Defence Architect** (agent 5) builds a defence per verified vulnerability: patch from `fixes.ts`, explanation (AI text if available, otherwise a template), remediation plan, trade-offs, and `verifyFix` dry-run.
6. The Auditor reports whether all dry-runs passed. Nothing is applied until a human approves.

## Controls on agents
- Permitted tools and forbidden actions are declared per agent (documentation + enforced by construction: agents can only call `scenario.reproduce`, simulator methods, patch builders).
- No shell, no network, no arbitrary code. The LLM never writes the patch or executes anything.
- Per-assessment AI call budget (12), 25 s timeout, one retry, prompt redaction (`redact`) for keys, emails and long tokens.
- Output schema: `FindingSchema` / `AgentOutputSchema` (Zod); malformed output fails validation.

## Conflicts
Agents own disjoint scenario sets, so conflicting findings for the same test case do not occur in the current design; duplicates are merged by ID. If a claim disagrees with the Auditor, the Auditor's result wins (reject, or severity correction).
