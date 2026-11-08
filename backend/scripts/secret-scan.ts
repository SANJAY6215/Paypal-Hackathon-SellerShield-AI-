/**
 * Secret exposure scan. Reads the REAL secret values from backend/.env and searches the project for them,
 * plus generic token patterns. It prints only variable NAMES, file paths and counts - never values.
 * Usage: cd backend && npx tsx scripts/secret-scan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const ROOT = path.resolve(__dirname, '../..');
const SECRET_NAMES = /KEY|SECRET|TOKEN|PASSWORD|WEBHOOK_ID|CLIENT_ID/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|txt|css|html|map|example|env|patch|log|csv|svg)$/i;
const env = dotenv.parse(fs.readFileSync(path.join(ROOT, 'backend/.env')));
const secrets = Object.entries(env).filter(([k, v]) => SECRET_NAMES.test(k) && v.length >= 8) as [string, string][];
const PATTERNS: [string, RegExp][] = [
  ['github token', /(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/],
  ['groq key', /gsk_[A-Za-z0-9]{20,}/],
  ['google api key', /AIza[A-Za-z0-9_-]{30,}/],
  ['openai-style key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

type Hit = { file: string; what: string; count: number };
const hits: Hit[] = [];
let scanned = 0;

function walk(dir: string, area: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, area); continue; }
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    const isEnvFile = /(^|\/)\.env($|\.)/.test(rel) && !rel.endsWith('.env.example');
    if (isEnvFile || /\.db(-journal)?$/.test(e.name) || /\.nft\.json$/.test(e.name) || !TEXT_EXT.test(e.name)) continue; // .nft.json = build trace file lists, no content
    if (fs.statSync(p).size > 8_000_000) continue;
    const text = fs.readFileSync(p, 'utf8');
    scanned++;
    for (const [name, val] of secrets) { const c = text.split(val).length - 1; if (c) hits.push({ file: rel, what: `value of ${name}`, count: c }); }
    for (const [label, re] of PATTERNS) {
      const g = new RegExp(re.source, 'g'); const m = text.match(g);
      if (m) hits.push({ file: rel, what: `pattern: ${label}`, count: m.length });
    }
  }
}
walk(ROOT, 'repo');

const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const report = {
  secretVariablesChecked: secrets.map(([k]) => k),
  filesScanned: scanned,
  gitignoreProtects: { '.env': /^\.env$/m.test(ignored), '.env.*': /^\.env\.\*$/m.test(ignored), 'allows .env.example': /^!\.env\.example$/m.test(ignored), 'databases': /\*\.db/.test(ignored) },
  hits,
  note: 'Values are never printed. frontend/.next is included in the scan when present. Screenshots (PNG) cannot be text-scanned: review them by eye.',
};
console.log(JSON.stringify(report, null, 2));
process.exit(hits.length ? 1 : 0);
