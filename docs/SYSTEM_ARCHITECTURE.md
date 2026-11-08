# System Architecture

Verified against the source in `backend/src` and `frontend/app` (2026-11-08).

```mermaid
flowchart TD
  U[User / Judge] --> FE[Next.js frontend :3000<br/>React Flow, Recharts]
  FE -- "/api/* proxy, httpOnly JWT cookie" --> API[Express API :4000<br/>Zod, Helmet, rate limit, RBAC]
  API --> ORCH[Orchestrator<br/>orchestrator.ts]
  subgraph Investigators run in parallel
    A1[Opportunist] --- A2[Refund Abuse] --- A3[Payment Manipulation] --- A4[Insider Threat]
  end
  ORCH --> A1 & A2 & A3 & A4
  A1 & A2 & A3 & A4 -- "claims (Zod-validated)" --> ORCH
  A1 & A2 & A3 & A4 -. "run scenario.reproduce()" .-> SIM[(Deterministic NovaCart simulator<br/>rules.ts, shop.ts, scenarios.ts)]
  ORCH --> CHAIN[Attack-chain engine<br/>chains.ts]
  CHAIN -- "execute path vs secure baseline" --> SIM
  ORCH --> AUD[Independent Auditor<br/>re-reproduce x2, ledger invariants, exposure recompute]
  AUD --> SIM
  AUD -- "verified / rejected" --> DB[(Prisma DB<br/>SQLite default)]
  ORCH --> DEFA[Defence Architect<br/>diff of vulnerable vs secure rule source]
  DEFA --> PATCH[Defence record + sandbox dry-run]
  PATCH --> APPR{Human approval<br/>+ explicit confirm}
  APPR -- apply (demo app only) --> STATE[DemoAppState: applied fixes + config]
  STATE --> TESTS[Regression tests: original attack, legit flows, no new exploits, chains]
  TESTS --> MEM[Attack Memory: statuses, history, reintroduced detection]
  MEM --> DB
  STATE -. "config change disables a fix" .-> MEM
  API --> PP[PayPal service<br/>Sandbox or labelled local simulation]
  ORCH -. "optional: hypothesis ordering, explanations" .-> LLM[AI provider chain<br/>Gemini then Groq with failover]
```

## Components
| Component | Files | Notes |
|---|---|---|
| Frontend | `frontend/app/**`, `components/` | 12 routes; relative imports; polls backend job state every 0.7–1 s |
| API | `backend/src/app.ts` | session cookie auth, roles `admin/analyst/viewer`, tenant scoping, `Idempotency-Key` support |
| Orchestrator | `orchestrator.ts` | stages: investigating → correlating → verifying → defending → auditing → completed; also `regression` and `website` modes |
| Agents | `agents.ts` | definitions, Zod schemas, optional AI planning, `auditFinding` |
| Simulator | `simulator/` | business rules in vulnerable + secure variants; 13 scenarios; ledger audit |
| Chains | `simulator/chains.ts` | relationship edges, DFS path generation, execution, graph build |
| Defence | `defence.ts`, `simulator/fixes.ts` | patch = unified diff of real source; approve/apply/rollback/test |
| Finance | `finance.ts` | transparent exposure formula |
| PayPal | `paypal.ts` | OAuth cache, Orders, captures, refunds, webhook verification, dedupe |
| Security | `security.ts` | SSRF-safe fetch, crawler, upload validation |
| Reports | `reports.ts` | JSON + PDF (pdfkit) |

## Execution model
Jobs are asynchronous but **in-process**: state is written to `Assessment`/`AgentRun` rows after every step, the UI polls them. A server restart marks running assessments failed. No queue/Redis (the `REDIS_URL` variable is unused).

## Data model
Prisma models: User, Merchant, DemoAppState, UploadedDocument, Assessment, AgentRun, Vulnerability (unique per merchant+test case), AttackChain, AttackStep, Defence, RegressionTest, SandboxTransaction, WebhookEvent (unique `eventId`), IdempotencyKey, AttackMemory, Report, AuditLog. `prisma/schema.postgres.prisma` is the same schema with the PostgreSQL provider — **untested**.

## Vulnerability lifecycle
`detected → verified | rejected` (Auditor) → `fixed` (defence tests passed) → `resolved` (re-scan no longer reproduces, or manual) → `reintroduced` (reproduces again after being fixed/resolved). Rolling back a fix returns the vulnerability to `verified`.
