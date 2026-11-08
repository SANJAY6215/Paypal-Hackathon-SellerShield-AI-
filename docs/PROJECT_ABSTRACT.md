# Project Abstract — SellerShield AI

**Discover. Connect. Verify. Defend. Remember.**

Online merchants lose money not only to single bugs but to *combinations* of small weaknesses in their own commerce logic: a coupon engine that stacks, a refund calculation that ignores the discount, and a refund endpoint that accepts retries can together make a merchant refund far more than it collected. Conventional checks tend to look at such issues one at a time, and AI-generated findings are often unverified.

SellerShield AI is a merchant-side security testing and financial-resilience prototype. Six cooperating agents examine a controlled sample shop (NovaCart Electronics): four investigators probe discounts, refunds, payments/inventory and staff permissions; an orchestrator links verified weaknesses into attack chains and executes them in a deterministic simulator; an **Independent Auditor** reproduces every claim itself and rejects anything it cannot reproduce; a Defence Architect turns each verified weakness into a real code diff with regression tests. A human approves and confirms before a patch is applied to the demo application; the original attack is then replayed and must fail while legitimate refunds still work. A persistent attack memory reruns saved tests so a later configuration change that re-opens a fixed hole is detected as a regression.

In the demo, the "Discount-Stack Refund Siphon" collects $126 and refunds $200 where the correct outcome keeps $80 — $154 excess per simulated attack, versus $84 if the three weaknesses were exploited separately. All financial figures are labelled simulated projections.

**Status:** working end-to-end prototype with 82 backend tests and a 21-check browser E2E suite. Not yet validated: PostgreSQL, real PayPal Sandbox calls and webhook signature verification, live LLM calls. It is not a PayPal product, is not endorsed by PayPal, and does not predict real fraud.
