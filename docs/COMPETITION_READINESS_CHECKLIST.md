# Competition Readiness Checklist (2026-11-08)
✅ done and verified · ⚠ done, not verified · ⬜ needs you

**Product**
- ✅ Backend 82/82 tests, type-check, schema valid
- ✅ Frontend production build and type-check
- ✅ Browser E2E 21/21 (full demo, approval gate, rollback, regression, reports, navigation, tablet layout)
- ✅ Security probes (auth, CORS, rate limit, forged webhook, SSRF/upload unit tests)
- ✓ Render deployment with PostgreSQL, PayPal Sandbox and webhook verification, Groq live AI (executed 2026-11-08; the local test suite is not yet run on PostgreSQL)
**New features (2026-11-09)**
- ✅ Discovery Lab (search engine) verified in tests and browser; PayPal Red Team verified against a local emulator; Defence-as-PR verified against a local GitHub mock
- ✅ Real PayPal Sandbox: full red team RT-01..RT-07 passed on a human-approved order (capture, refund, replay, over-refund, reconciliation)
- ✅ Groq real discovery session via the UI (2 verified findings); Gemini kept disabled
- ✅ Security cleanup: JWT placeholder replaced, `.env.backup` deleted, secret scan clean
- Full status: docs/FINAL_HACKATHON_VALIDATION.md
- ⬜ **Still to run live and record**: red-team phase B (buyer approval), Gemini billing (Groq already verified live), a GitHub draft PR, webhook verification (PayPal Sandbox red team phase B, GitHub draft PR). This decides whether PayPal + AI is genuinely central for the judges.
**Materials**
- ✅ README, abstract, system/agent architecture, threat model, installation, deployment (unverified), limitations, validation report
- ✅ 10-slide content (`SELLERSHIELD_HACKATHON_PPT.md`) and editable PPTX with real screenshots (rendered and visually checked in PowerPoint)
- ✅ 3-minute demo script; judge Q&A (37 + 25 extra)
- ✅ 14 real screenshots in `docs/screenshots/`
- ⬜ Backup demo **video** (not recorded)
- ⬜ Team names, URLs, licence, GitHub repo, hosting
**Before you present**
- ⬜ Start both servers; open `/api/health`
- ⬜ Click **Reset demo** (E2E leaves state dirty)
- ⬜ Rehearse the script twice with a stopwatch
- ⬜ Know the ⚠ items and say "not tested" when asked
- ✅ Licence: MIT (`LICENSE`, Copyright (c) 2026 Sanjay B.); after pushing, confirm GitHub shows it in About
