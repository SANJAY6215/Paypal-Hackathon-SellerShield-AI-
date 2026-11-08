// Generates docs/SellerShield_AI_Hackathon.pptx from the content in SELLERSHIELD_HACKATHON_PPT.md and the real screenshots.
const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');
const SHOT = (n) => path.resolve(__dirname, '../screenshots', n);
const BG = '080D19', PANEL = '0E1626', INK = 'E6EBF7', MUTED = '8A97B5', BLUE = '3B82F6', CYAN = '22D3EE', RED = 'F87171', GREEN = '34D399';

const p = new pptxgen();
p.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
p.title = 'SellerShield AI';
const F = 'Segoe UI';

function base(title, n) {
  const s = p.addSlide();
  s.background = { color: BG };
  s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: BLUE } });
  s.addText(title, { x: 0.5, y: 0.3, w: 12, h: 0.7, fontFace: F, fontSize: 28, bold: true, color: INK });
  s.addText(`SellerShield AI  ·  ${n}/10`, { x: 0.5, y: 7.05, w: 6, h: 0.3, fontFace: F, fontSize: 10, color: MUTED });
  return s;
}
const img = (s, name, o) => { const f = SHOT(name); if (fs.existsSync(f)) s.addImage({ path: f, ...o }); };
const body = (s, txt, o) => s.addText(txt, { fontFace: F, fontSize: 16, color: INK, valign: 'top', paraSpaceAfter: 8, ...o });
const bullets = (arr) => arr.map((t) => ({ text: t, options: { bullet: true } }));

// 1
let s = p.addSlide(); s.background = { color: BG };
s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: BLUE } });
s.addText('SellerShield AI', { x: 0.7, y: 1.2, w: 7, h: 1, fontFace: F, fontSize: 48, bold: true, color: INK });
s.addText('AI-Powered Autonomous E-Commerce Security Platform', { x: 0.7, y: 2.2, w: 7, h: 0.8, fontFace: F, fontSize: 22, color: CYAN });
s.addText('Discover. Connect. Verify. Defend. Remember.', { x: 0.7, y: 3.2, w: 7, h: 0.5, fontFace: F, fontSize: 18, italic: true, color: INK });
s.addText('Merchant-side security testing and financial-resilience prototype', { x: 0.7, y: 3.8, w: 7, h: 0.5, fontFace: F, fontSize: 14, color: MUTED });
s.addText('Team: [Team name] · [Member 1] · [Member 2] · [Member 3]\nStack: Next.js · React Flow · Express/TypeScript · Prisma/SQLite · Zod · optional Gemini/Groq AI · optional PayPal Sandbox', { x: 0.7, y: 5.4, w: 7, h: 1.2, fontFace: F, fontSize: 12, color: MUTED });
img(s, '00-landing.png', { x: 7.9, y: 1.3, w: 5.0, h: 3.13 });

// 2
s = base('The problem', 2);
body(s, bullets(['Commerce logic fails in combinations: a discount rule, a refund formula and a retry path can each look harmless.', 'Isolated checks report them separately, not as one money-losing sequence.', 'AI-generated findings are often unverified: teams need evidence and a fix they can trust.']), { x: 0.6, y: 1.4, w: 7.6, h: 4.5, fontSize: 20 });
s.addShape(p.ShapeType.roundRect, { x: 8.7, y: 1.6, w: 4.1, h: 3.6, fill: { color: PANEL }, line: { color: '1D2943' } });
s.addText([{ text: 'coupon  +  refund formula  +  retry', options: { breakLine: true, color: MUTED, fontSize: 14 } }, { text: '=', options: { breakLine: true, color: INK, fontSize: 30 } }, { text: 'one financial attack', options: { color: RED, fontSize: 22, bold: true } }], { x: 8.7, y: 1.9, w: 4.1, h: 3, fontFace: F, align: 'center', valign: 'middle' });

// 3
s = base('Our solution', 3);
const steps = [['Discover', 'weaknesses'], ['Connect', 'into attack chains'], ['Verify', 'independently'], ['Defend', 'with a real diff'], ['Remember', 'so fixes cannot silently regress']];
steps.forEach(([a, b], i) => { s.addShape(p.ShapeType.roundRect, { x: 0.5 + i * 2.5, y: 1.4, w: 2.3, h: 1.5, fill: { color: PANEL }, line: { color: i === 2 ? GREEN : BLUE } }); s.addText([{ text: a, options: { bold: true, fontSize: 18, color: CYAN, breakLine: true } }, { text: b, options: { fontSize: 12, color: MUTED } }], { x: 0.5 + i * 2.5, y: 1.4, w: 2.3, h: 1.5, fontFace: F, align: 'center', valign: 'middle' }); });
body(s, 'New: an attacker that invents attack sequences (verified by replay) · a PayPal red team with ledger reconciliation · verified fixes shipped as draft pull requests. Exposure is always a labelled simulation.', { x: 0.5, y: 3.0, w: 12.3, h: 0.7, fontSize: 14, color: MUTED });
img(s, '06-dashboard.png', { x: 2.6, y: 3.6, w: 6.4, h: 3.4 });

// 4
s = base('Six-agent architecture', 4);
const ag = [['1 Opportunist', 'discounts, coupons, pricing'], ['2 Refund Abuse', 'refunds, cancellations'], ['3 Payment Manipulation', 'state, idempotency, races'], ['4 Insider Threat', 'roles, approvals, audit'], ['5 Defence Architect', 'diff + plan + tests'], ['6 Independent Auditor', 'reproduces, may reject']];
ag.forEach(([a, b], i) => { s.addShape(p.ShapeType.roundRect, { x: 0.5, y: 1.2 + i * 0.9, w: 4.4, h: 0.78, fill: { color: PANEL }, line: { color: i === 5 ? GREEN : '1D2943' } }); s.addText([{ text: a, options: { bold: true, fontSize: 14, color: INK, breakLine: true } }, { text: b, options: { fontSize: 11, color: MUTED } }], { x: 0.65, y: 1.2 + i * 0.9, w: 4.2, h: 0.78, fontFace: F, valign: 'middle' }); });
img(s, '02-agents.png', { x: 5.2, y: 1.2, w: 7.7, h: 4.81 });
s.addText('Agents run deterministic probes; an LLM (optional, not tested live) may only reorder them.', { x: 5.2, y: 6.2, w: 7.7, h: 0.6, fontFace: F, fontSize: 12, color: MUTED });

// 5
s = base('Compound attack: Discount-Stack Refund Siphon', 5);
[['$126', 'collected', BLUE], ['$200', 'refunded', RED], ['$80', 'correct outcome', GREEN], ['$154', 'excess per attack', 'FBBF24']].forEach(([n, l, c], i) => { s.addText([{ text: n, options: { fontSize: 36, bold: true, color: c, breakLine: true } }, { text: l, options: { fontSize: 12, color: MUTED } }], { x: 0.5 + i * 2.4, y: 1.1, w: 2.3, h: 1.2, fontFace: F, align: 'center' }); });
s.addText('Exploited separately: $34 + $20 + $30 = $84.  Chained: $154.\nPhantom Payment Insider Payout: $240 per attack (isolated $90 + $120).\nAll values are simulated.', { x: 0.5, y: 2.4, w: 12.3, h: 0.9, fontFace: F, fontSize: 14, color: INK });
img(s, '07-attack-chain-explorer.png', { x: 1.6, y: 3.35, w: 6.4, h: 3.6 });
s.addText('1  Stack 3 coupons: pays $126 (policy: one coupon)\n2  Refund 2 units: pays $100 at list price\n3  Replay the request: pays $100 again', { x: 8.3, y: 3.6, w: 4.7, h: 2, fontFace: F, fontSize: 13, color: INK });

// 6
s = base('Independent Auditor', 6);
body(s, bullets(['A finding is a claim until the Auditor reproduces it from fresh state, twice.', 'Checks ledger invariants and recomputes the dollar figure.', 'Rejected in tests: inflated claim, unknown test case, attack that no longer reproduces.', 'Can correct severity. Only reproduced findings count as verified.']), { x: 0.6, y: 1.3, w: 5.6, h: 5, fontSize: 16 });
img(s, '09-vulnerability-evidence.png', { x: 6.5, y: 1.3, w: 6.4, h: 4.0 });

// 7
s = base('Autonomous defence: real diff, human approved', 7);
s.addText('- const amount = Math.round(line.unitPrice * qty * 100) / 100;  // BUG\n+ const share = (line.unitPrice * qty) / order.subtotal;\n+ const remaining = round(order.total - order.refunded);\n+ const amount = Math.min(round(order.total * share), remaining);', { x: 0.5, y: 1.2, w: 12.3, h: 1.3, fontFace: 'Consolas', fontSize: 13, color: GREEN, fill: { color: PANEL } });
s.addText('Generate → review diff → approve → explicit confirmation → apply to the demo app only → regression tests → rollback. Nothing touches production.', { x: 0.5, y: 2.7, w: 12.3, h: 0.7, fontFace: F, fontSize: 15, color: INK });
img(s, '03-patch-diff-and-approval.png', { x: 0.5, y: 3.5, w: 5.9, h: 3.4 });
img(s, '04-attack-blocked.png', { x: 6.9, y: 3.5, w: 5.9, h: 3.4 });

// 8
s = base('Regression memory', 8);
['1 Fix verified, tests saved', '2 Attack blocked', '3 Rule changed: coupon stacking back on', '4 Rerun previous tests', '5 DISC-001 flagged: reintroduced'].forEach((t, i) => { s.addShape(p.ShapeType.roundRect, { x: 0.5 + i * 2.5, y: 1.2, w: 2.3, h: 1.0, fill: { color: PANEL }, line: { color: i === 4 ? RED : BLUE } }); s.addText(t, { x: 0.5 + i * 2.5, y: 1.2, w: 2.3, h: 1.0, fontFace: F, fontSize: 12, color: INK, align: 'center', valign: 'middle' }); });
img(s, '11-regression-memory.png', { x: 2.4, y: 2.5, w: 8.5, h: 4.5 });

// 9
s = base('Technology and roadmap', 9);
const rows = [[['Implemented and tested', GREEN], ['Implemented, NOT tested', 'FBBF24'], ['Planned', MUTED]], [['Next.js 15 · React Flow · Recharts\nExpress + TypeScript + Zod · JWT cookie · RBAC\nPrisma + SQLite\nDeterministic simulator, 13 scenarios\n82 backend tests · 21-check Chrome E2E\nJSON + PDF reports', INK], ['PostgreSQL (schema + compose)\nPayPal Sandbox calls and webhook signature verification\nLive LLM calls\nRender deployment', INK], ['More simulated apps\nSource-aware analysis of uploaded repos\nQueue workers\nMerchant-calibrated model\nLive-Sandbox CI', INK]]];
rows[0].forEach(([t, c], i) => s.addText(t, { x: 0.5 + i * 4.2, y: 1.2, w: 4.0, h: 0.5, fontFace: F, fontSize: 16, bold: true, color: c }));
rows[1].forEach(([t, c], i) => s.addText(t, { x: 0.5 + i * 4.2, y: 1.8, w: 4.0, h: 4.5, fontFace: F, fontSize: 13, color: c, valign: 'top', paraSpaceAfter: 8 }));

// 10
s = p.addSlide(); s.background = { color: BG };
s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: BLUE } });
s.addText('Security Should Not Stop at Detection.', { x: 0.7, y: 2.0, w: 12, h: 1.2, fontFace: F, fontSize: 44, bold: true, color: INK });
s.addText('SellerShield AI transforms security findings into verified, actionable defence and continuous protection.', { x: 0.7, y: 3.4, w: 11, h: 0.9, fontFace: F, fontSize: 20, color: CYAN });
s.addText('Website: [URL]   ·   GitHub: [repo URL]   ·   Team: [names / contacts]', { x: 0.7, y: 5.6, w: 11, h: 0.5, fontFace: F, fontSize: 14, color: MUTED });

p.writeFile({ fileName: path.resolve(__dirname, '../SellerShield_AI_Hackathon.pptx') }).then((f) => console.log('wrote', f));
