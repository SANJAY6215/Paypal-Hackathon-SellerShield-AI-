# PayPal integration
Modes: `sandbox` when `PAYPAL_CLIENT_ID/SECRET` are set (calls refused unless the base URL contains "sandbox"), otherwise `demo` (local simulation, stored as `local-simulation`).
Endpoints used: `/v1/oauth2/token`, `POST/GET /v2/checkout/orders`, `/capture`, `/v2/payments/captures/{id}/refund`, `/v2/payments/refunds/{id}`, `/v1/notifications/verify-webhook-signature`.
Rules: created/approved ≠ paid (only COMPLETED); capture is idempotent (`PayPal-Request-Id: capture-<order>`); refunds capped at remaining balance; token cached server-side only.
Webhooks: `POST /api/paypal/webhooks` (raw body). Verified via PayPal API, or by local HMAC for simulated events. Unverified payloads are stored as `rejected_unverified` and never change state. `eventId` is unique so replays are ignored. Handled: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.PENDING/COMPLETED/DENIED/REFUNDED.
Status: not exercised against live Sandbox in this build.
