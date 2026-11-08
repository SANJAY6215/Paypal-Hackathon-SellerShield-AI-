# Demo Guide
The timed 3-minute script (with expected UI output, fallbacks and backup plan) is in [SELLERSHIELD_LIVE_DEMO_SCRIPT.md](SELLERSHIELD_LIVE_DEMO_SCRIPT.md).

## Quick path (no credentials)
1. Start backend and frontend ([INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)).
2. http://localhost:3000 → **Explore Live Demo** → **Reset demo** → **Run Live Demo** (~15 s).
3. Stage 9: review diffs, tick the confirmation, **Approve and apply** → Stage 10: **Replay the original attack** → blocked.
4. Regression: Merchant Setup → *Allow coupon stacking* **On** → Attack Memory → **Rerun previous tests** → DISC-001 reintroduced.
5. Optional: PayPal page → **Run** self-test (local simulation) → Reports → **Generate report** (PDF/JSON).
6. **Reset demo** to repeat.

Seeded fixture: the first login runs the real simulator once and labels it "Demo data"; nothing is replayed from canned results. PayPal and AI are labelled DEMO / deterministic unless credentials are configured (those paths are untested).
