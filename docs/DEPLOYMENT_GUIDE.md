# Deployment Guide (manual setup on Render, NOT yet verified)

No deployment has been performed. There is no Blueprint (`render.yaml`) by design: create the three resources by hand in the Render dashboard, in the order below. Treat every step as unverified until you have run it.

## Topology
PostgreSQL database -> `sellershield-api` (Node web service, backend) -> `sellershield-web` (Node web service, frontend). The browser only talks to the frontend; Next rewrites `/api/*` to the backend, so the session cookie stays same-origin and CORS is not needed for the app itself (`APP_URL` still sets the allowed origin).

## 1. PostgreSQL
*New -> PostgreSQL.* Name `sellershield-db`, database `sellershield`, same region as the services. Use a paid instance for anything you need to keep (a free Render Postgres is deleted after 30 days). Copy the **Internal Database URL** (use the External one only from your own machine, e.g. pgAdmin or the migration script).

## 2. Backend web service
*New -> Web Service,* connect the GitHub repo.
- Root directory: `backend`
- Build command: `npm install --include=dev && npx prisma generate`
- Start command: `npx prisma db push --skip-generate && npm start`
- Health check path: `/api/health`
- Environment: `NODE_ENV=production`, `DATABASE_URL` = the Internal Database URL, `JWT_SECRET` = a long random value, `DEMO_MODE=true` for a public demo (this exposes an admin demo login: set `false` for anything real), `GEMINI_ENABLED=false`, optional `GROQ_API_KEY`, optional PayPal **Sandbox** keys (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`, `PAYPAL_WEBHOOK_ID`).
- Do not scale beyond one instance: jobs run in-process.

## 3. Frontend web service
*New -> Web Service,* same repo.
- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: `API_URL` = the backend's public URL (e.g. `https://sellershield-api.onrender.com`). It is read **at build time**, so set it before the first build and redeploy after any change.

Then set the backend's `APP_URL` to the frontend's public URL and redeploy the backend.

## 4. Verify
Open the frontend URL -> Explore Live Demo -> Run Live Demo. Check the backend `GET /api/health`, and connect pgAdmin to the External Database URL to see the tables.

## Moving existing local data (optional)
From `backend/` with `DATABASE_URL` set to the target Postgres (External URL for Render): `npm run db:push`, `npm run db:generate-sqlite-legacy`, `npm run db:migrate-from-sqlite`. It copies `prisma/dev.db` (override with `SQLITE_PATH`) and is safe to re-run.

## PayPal webhooks (optional, untested)
Register `https://<backend>/api/paypal/webhooks` in the PayPal developer dashboard and set `PAYPAL_WEBHOOK_ID`. See `WEBHOOK_SETUP.md`. Without credentials the app labels everything "DEMO MODE (local simulation)".

## Hardening before any public exposure
`NODE_ENV=production` (secure cookies; JWT guard), `DEMO_MODE=false` unless it is a throwaway demo, a queue instead of in-process jobs if running more than one instance, monitoring, and the dependency advisories listed in `FINAL_TECHNICAL_VALIDATION.md`.
