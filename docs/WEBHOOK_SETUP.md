# Real PayPal Sandbox webhook verification: setup and test plan

**Status: BLOCKED - HUMAN ACTION REQUIRED.** `PAYPAL_WEBHOOK_ID` is empty and the backend has no public HTTPS URL, so no real PayPal delivery has ever reached this app. Everything below the "Already verified" line is what has *not* been done.

## How verification is implemented (`backend/src/paypal.ts`)
`POST /api/paypal/webhooks` receives the **raw body**, then `verifyWebhook()` calls PayPal's `POST /v1/notifications/verify-webhook-signature` with the five `paypal-*` headers, the configured `PAYPAL_WEBHOOK_ID` and the raw event JSON; only `verification_status: SUCCESS` counts as `verified`. Without credentials / webhook id the event is `unverifiable`; missing headers or a failed check is `failed`. Unverified events are stored as `rejected_unverified` and never change payment state. `eventId` is unique, so a replay returns `duplicate` without re-processing. Handled types: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.PENDING|COMPLETED|DENIED|REFUNDED|REVERSED`.

## Already verified (NOT real PayPal deliveries)
| Check | Label |
|---|---|
| Forged / unsigned payload → HTTP 401, stored `rejected_unverified`, state unchanged | **LOCAL** test against the real endpoint (curl + vitest) |
| Missing `event_type`/`id`, malformed JSON → HTTP 400 | **LOCAL** |
| Duplicate event id not processed twice; REVERSED processed when verified | **LOCAL HMAC simulation** (`verified_local_simulation`) - *not* PayPal's mechanism |
| `verify-webhook-signature` call shape against the emulator (`SUCCESS`/`FAILURE`) | **EMULATOR** |

## What the owner must do (about 15 minutes)
1. **Expose the backend over public HTTPS** (needed because PayPal must reach it). Options: `cloudflared tunnel --url http://localhost:4000` or `ngrok http 4000`, or deploy the backend (see `DEPLOYMENT_GUIDE.md`). Use the HTTPS URL it prints.
2. In the **PayPal Developer Dashboard → Apps & Credentials → (your Sandbox app) → Webhooks → Add Webhook**, set the URL to `https://<public-host>/api/paypal/webhooks` and subscribe to: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED` (plus `PENDING`/`DENIED` if you want them). Only register a URL you control.
3. Copy the **Webhook ID** shown after saving into `backend/.env` as `PAYPAL_WEBHOOK_ID=` (never paste it in chat), then restart the backend.
4. Generate real events: run the PayPal Red Team on **PayPal Sandbox**, approve the order as the Sandbox buyer, press *Continue* (this captures and refunds in Sandbox, which makes PayPal send `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`).
5. Open **PayPal Integration → Webhook event log**. A real, verified delivery shows `verified` (not `verified_local_simulation`). Optionally use the Dashboard's *Webhooks event simulator* / *resend* to redeliver the same event id and confirm it is reported as a duplicate.
6. Record the outcome here and in `FINAL_HACKATHON_VALIDATION.md`.

**Do not mark this complete** unless the log shows a real `verified` event that arrived from PayPal. A tunnel URL changes on restart for free plans; update the registered URL if it does.
