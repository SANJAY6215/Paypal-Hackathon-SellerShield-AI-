# Installation Guide

Requirements: Node.js 20+ (developed on v26), npm, Chrome/Edge only if you run the E2E suite. No Docker or database server is needed for the default setup.

## 1. Backend
```bash
cd backend
npm install
cp ../.env.example .env         # Windows PowerShell: Copy-Item ..\.env.example .env
npm run db:push                 # creates prisma/dev.db (SQLite) and generates the Prisma client
npm test                        # optional: 82 tests
npm start                       # http://localhost:4000  (GET /api/health)
```
Edit `.env` only if you want to enable optional integrations. Never commit `.env`.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` (SQLite, relative to `prisma/`) | yes |
| `JWT_SECRET` | session signing; **must be ≥32 random chars in production** (server refuses to start otherwise) | prod |
| `APP_URL` | frontend origin for CORS | yes (default `http://localhost:3000`) |
| `DEMO_MODE` | enables the one-click demo login | default `true` |
| `AGENT_STEP_DELAY_MS` | pacing of live runs (default 450) | no |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `GEMINI_MODEL`, `GROQ_MODEL`, `LLM_PROVIDER_ORDER` | optional LLM attacker / explanations with failover (see docs/LLM_LIVE_VALIDATION.md) | no |
| `PAYPAL_CLIENT_ID/SECRET/WEBHOOK_ID`, `PAYPAL_BASE_URL` | optional PayPal Sandbox (untested) | no |

## 2. Frontend
```bash
cd frontend
npm install
npm run build && npm start      # http://localhost:3000
# or: npm run dev
```
The frontend proxies `/api/*` to `http://localhost:4000`. To point at another backend set `API_URL` **at build time** (read in `next.config.mjs`).

## 3. First run
Open http://localhost:3000 → **Explore Live Demo**. The first login seeds a NovaCart fixture assessment (produced by the simulator, labelled "Demo data"). Press **Reset demo** then **Run Live Demo** for a fresh run (~15 s).

## 4. Browser E2E (optional)
```bash
cd e2e && npm install && node e2e.js     # needs both servers running; writes docs/screenshots and e2e/results
```
It resets the demo and leaves the demo database used. Press **Reset demo** afterwards.

## 5. PostgreSQL (unverified)
`docker compose up -d`; copy `prisma/schema.postgres.prisma` over `prisma/schema.prisma`; set `DATABASE_URL=postgresql://sellershield:sellershield@localhost:5432/sellershield`; `npm run db:push`. This path has not been executed.

## Troubleshooting
- Windows/OneDrive: if `next build` fails with `EINVAL readlink .next`, stop the running `next start` and delete `frontend/.next`.
- If `prisma generate` creates a stray `package.json` at the repo root, delete it.
- Git Bash rewrites arguments that start with `/`; run route-style CLI args from PowerShell.
