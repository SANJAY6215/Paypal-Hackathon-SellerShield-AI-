# Demo Video Script: under 3 minutes (target 2:45)

Hackathon rules for the video: **under 3 minutes**, shows the project **functioning on the device it was built for**, **uploaded to YouTube, publicly visible**, link on the submission form, **no third-party trademarks or copyrighted music/material without permission**.
Everything on screen must be a genuine recording of the running app. Never show a stored screenshot as if it were a live action; if you use a still, caption it ("recorded earlier").

## Labels to show on screen (burned in as captions)
| Segment | Caption to display |
|---|---|
| PayPal Red Team | **LIVE: PayPal Sandbox** (RT-01 to RT-07). RT-08/09 = "SellerShield endpoint test" |
| Guided search | **LOCAL simulator, no AI** |
| LLM discovery | **LIVE: Groq LLM, replay-verified** |
| Defence patch | **LOCAL: simulated shop, human-approved** |
| Pull request | **PREVIEW ONLY: real GitHub PR not yet created** (or **LIVE: GitHub draft PR** only if one exists) |
| Webhooks | **NOT YET VERIFIED LIVE** (say so in one sentence) |

## Shot list with timestamps
| Time | Screen (record live) | Narration |
|---|---|---|
| 0:00-0:15 | Landing page, then Dashboard | "Online sellers lose money to combinations of small logic flaws: a coupon rule, a refund formula and a retry. SellerShield AI attacks a shop's own logic and PayPal's payment protocol, proves the loss, verifies a fix and remembers it. Everything you'll see is a simulation unless labelled live." |
| 0:15-0:55 | **PayPal Integration → PayPal Red Team** → choose the stored run under *Recent runs: PayPal Sandbox*. Scroll RT-01 to RT-07. Hover on the order, capture and refund ids. | "This ran against the real PayPal Sandbox with a human approving the buyer step. PayPal enforced idempotency, rejected a capture before approval, rejected a duplicate capture, replayed the same refund id and refused a second $100 refund against a $126 capture. **Then the reconciliation: PayPal stopped the extra payout, but our shop's own refund logic would have booked $200 against PayPal's $100. A $100 accounting divergence, and the fix belongs in the merchant's refund code, not at PayPal.**" |
| 0:55-1:25 | **Discovery Lab → Guided search → Run discovery** (about 5 s). Zoom on *Cancel-for-Cash*: 3 actions, $160. | "No AI here: an exhaustive search of 155,000 action sequences found that marking a payment pending, then cancelling, refunds money that never arrived. It's outside our scripted scenarios, and it's blocked by the payment-state fix." |
| 1:25-1:50 | Same page, the **pre-run Groq LLM session** (run it *before* recording and do not reset afterwards: it takes about 2 minutes on the free tier). Show the trace with tool calls and the verified findings; open *Show independent verification*. | "A real LLM drives the shop through tool calls and improvises attacks. Its claims are never trusted: every sequence is replayed on the vulnerable shop and a secure baseline. Both findings here are known root causes via new paths, and hallucinated attacks are rejected." |
| 1:50-2:25 | **Live Demo** or **Defence Center**: show the unified diff, tick the confirmation, apply, then **Replay the original attack → FAILED (blocked)** and the legitimate-refund checks passing. | "Fixes arrive as real code diffs, need human approval and an explicit confirmation, apply only to the demo app, and are proven by replaying the attack." |
| 2:25-2:40 | Defence Center → **Preview pull request** (patch, regression test, report). | "Verified fixes can be opened as a draft GitHub pull request, never merged automatically. **[Say honestly: this is a preview; real GitHub creation is not yet verified.]**" (If a real draft PR exists, show its GitHub page and say so instead.) |
| 2:40-2:55 | Attack Memory → Rerun previous tests → *reintroduced* (optional) **or** the Dashboard | "Live-verified: PayPal Sandbox and Groq. Not yet live: webhook signature verification and the GitHub PR. Security should not stop at detection." |

Total about 2:55. Cut the Attack Memory shot first if you run long; the hard limit is 3:00, so aim for 2:45.

## Pre-recording setup (do once, in order)
1. Start backend and frontend; open http://localhost:3000. Use a **fresh browser profile** (no other tabs, no bookmarks bar, no extensions) so no email, API-key pages or personal accounts appear.
2. Sign in via **Explore Live Demo**. Click **Reset demo** (this keeps your real Sandbox run).
3. **Record in two takes, in this order** (both *Live Demo* and *Reset demo* wipe stored Discovery runs, but never your real Sandbox run):
   - **Take A (defence, 1:50-2:40):** Live Demo → Run → review diff → confirm → apply → replay (attack blocked) → Defence Center → Preview pull request.
   - Then **Reset demo**, and **pre-run the Groq LLM discovery** (Discovery Lab → LLM attacker → Run discovery; about 2 minutes on the free tier) and the guided search. Do **not** reset or press Live Demo again.
   - **Take B (0:00-1:50):** Dashboard intro, PayPal Red Team (stored Sandbox run), guided search, the finished Groq session.
   Edit Take B before Take A in the final video (timeline order above); do not alter what the app shows.
4. The LLM engine runs against whatever fixes are currently applied: after Reset the app is unpatched, which is what you want for Take B.
5. Open PayPal Integration and confirm *Recent runs* lists the **PayPal Sandbox** run (completed).
6. Browser zoom 110-125 %, window 1920x1080, notifications off, microphone test.

## Recording checklist
- [ ] Screen recorder set to 1080p, 30 fps; record the browser window only
- [ ] No secrets on screen: never open `.env`, never show the PayPal Developer Dashboard credentials, the GitHub token page, Gmail or any real PayPal account
- [ ] No personal data (names, emails, DOB); Sandbox buyer details stay off-screen
- [ ] Captions for every LIVE / LOCAL / PREVIEW label in the table above
- [ ] Royalty-free or **no** music; no brand logos other than what the app/PayPal Sandbox pages display
- [ ] Do not speed up or splice live API calls in a way that misrepresents timing (the LLM run is pre-run; say "recorded earlier")
- [ ] Say the limitations out loud (webhooks, GitHub PR, Gemini off)
- [ ] Total length under 3:00 (check the exported file, not the timeline)
- [ ] Export MP4; upload to YouTube as **Public** (not Unlisted/Private); paste the link in the submission form; open it in a private window to confirm it plays

## Stills you may use (always captioned with their label)
`docs/screenshots/final/LIVE-paypal-redteam-sandbox-phaseB-complete.png` (LIVE), `LIVE-discovery-groq-llm-session-fullpage.png` (LIVE, recorded earlier), `LOCAL-discovery-guided-search-cancel-for-cash.png` (LOCAL), `LOCAL-defence-center-proposed-patch.png` (LOCAL), `docs/redteam-live-sandbox-run.json` (data). **No still exists for a real GitHub PR or a real webhook; do not create or imply one.**

## Incomplete integrations to disclose
GitHub draft PR (preview only until a real one is created) · PayPal webhook signature verification (not live) · Gemini (disabled; billing) · attack simulation covers the built-in NovaCart shop only.
