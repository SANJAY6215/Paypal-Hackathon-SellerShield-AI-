# Deployment Guide (prepared, NOT verified)

No deployment has been performed. No Render configuration existed in the repository; `render.yaml` was created from the code and has never been executed. Treat every step below as unverified until you run it.

## Topology
Two Node web services: `sellershield-api` (backend) and `sellershield-web` (frontend). The browser only talks to the frontend; Next rewrites `/api/*` to the backend, so the session cookie stays same-origin and CORS is not needed for the app itself (`APP_URL` still sets the allowed origin).

## Render (render.yaml)
1. Push the repo to your own GitHub (see `GITHUB_READINESS.md`), then *New → Blueprint* and select `render.yaml`.
2. Backend env: `JWT_SECRET` (generated), `APP_URL` = frontend URL, `DEMO_MODE=true` for a public demo (this exposes an admin demo login — set `false` for anything real), optional AI/PayPal keys.
3. Frontend env: `API_URL` = backend URL. It is read **at build time**, so set it before the first build and redeploy after any change.
4. Health check: `GET /api/health` on the backend.
5. Verify: open the frontend URL → Explore Live Demo → Run Live Demo.

## Database
- **SQLite (default)** stores data in `DATABASE_URL=file:/var/data/sellershield.db` on a Render persistent disk (paid plan). A disk attaches to one instance: **do not scale the API beyond one instance** and expect downtime on deploys. Not suitable for multi-instance production. Free instances without a disk lose data on every restart.
- **PostgreSQL (recommended for production, UNVERIFIED):** create a Render Postgres, set `DATABASE_URL`, replace `prisma/schema.prisma` with `schema.postgres.prisma`, run `prisma db push` (or create migrations). JSON columns map to `jsonb`; this has not been run, so expect to debug.

## PayPal webhooks (optional, untested)
Set `PAYPAL_CLIENT_ID/SECRET` (Sandbox only) and `PAYPAL_WEBHOOK_ID`; register `https://<backend>/api/paypal/webhooks` in the PayPal developer dashboard. Without credentials the app labels everything "DEMO MODE (local simulation)".

## Hardening before any public exposure
Set `NODE_ENV=production` (secure cookies; JWT guard), set `DEMO_MODE=false` unless it is a throwaway demo, replace in-process jobs with a queue if running more than one instance, add monitoring, and address the dependency advisories listed in `FINAL_TECHNICAL_VALIDATION.md`.

## What remains for you
GitHub repo, Render account/blueprint, env values, choosing SQLite-disk vs Postgres, and testing the deployed URL.
