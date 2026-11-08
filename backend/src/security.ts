import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

// ------------------------------------------------------------------ SSRF
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  if (!net.isIPv4(ip)) return true;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0);
}

const BLOCKED_HOSTS = ['localhost', 'metadata.google.internal', 'metadata', 'instance-data'];

export function validateUrlShape(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('Invalid URL'), { status: 400 }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('Only http and https URLs are allowed'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('Credentials in URLs are not allowed'), { status: 400 });
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.includes(h) || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) throw Object.assign(new Error('Host is not allowed'), { status: 400 });
  if (net.isIP(h) && isPrivateIp(h)) throw Object.assign(new Error('Private or reserved addresses are not allowed'), { status: 400 });
  return u;
}

/** DNS lookup that refuses private/loopback/link-local/metadata answers at connect time (defeats DNS rebinding). */
const safeLookup: any = (hostname: string, opts: any, cb: any) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateIp(a.address));
    if (bad || !addrs.length) return cb(new Error('Blocked address ' + (bad?.address ?? '')));
    if (opts?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
};

export interface SafeResponse { status: number; url: string; contentType: string; body: string }

export function safeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {}): Promise<SafeResponse> {
  const { maxBytes = 1_000_000, timeoutMs = 8000, maxRedirects = 3 } = opts;
  const go = (urlStr: string, depth: number): Promise<SafeResponse> => new Promise((resolve, reject) => {
    let u: URL;
    try { u = validateUrlShape(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup: safeLookup, timeout: timeoutMs, headers: { 'user-agent': 'SellerShieldBot/1.0 (public-page analysis)', accept: 'text/html,text/plain' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (depth >= maxRedirects) return reject(new Error('Too many redirects'));
        return resolve(go(new URL(res.headers.location, u).toString(), depth + 1));
      }
      const ct = String(res.headers['content-type'] || '');
      if (!/text\/|json|xml/.test(ct)) { res.resume(); return reject(new Error('Unsupported content type: ' + ct)); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('Response too large')); } else chunks.push(c); });
      res.on('end', () => resolve({ status, url: u.toString(), contentType: ct, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
  return go(raw, 0);
}

// --------------------------------------------------------------- crawler
export interface Observation { page: string; kind: string; text: string }
export interface CrawlResult { startUrl: string; pagesFetched: string[]; observations: Observation[]; limitations: string[]; errors: string[] }

const INTERESTING = /product|shop|collection|refund|return|shipping|cancel|policy|policies|terms|contact|faq|sale|discount|checkout|cart/i;

/** Controlled crawler: homepage + up to 6 same-origin pages. Never logs in, never submits forms, never bypasses controls. */
export async function crawlPublicSite(rawUrl: string, fetcher: typeof safeFetch = safeFetch): Promise<CrawlResult> {
  const start = validateUrlShape(rawUrl);
  const result: CrawlResult = {
    startUrl: start.toString(), pagesFetched: [], observations: [], errors: [],
    limitations: [
      'Assessment covers publicly observable configuration only.',
      'Internal checkout, refund and payment logic is not visible from a public website and was NOT tested.',
      'No logins, CAPTCHAs, paywalls or security controls were bypassed.',
    ],
  };
  const queue: string[] = [start.toString()];
  const seen = new Set<string>();
  while (queue.length && result.pagesFetched.length < 7) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetcher(url);
      if (res.status >= 400) { result.errors.push(`${url}: HTTP ${res.status}`); continue; }
      result.pagesFetched.push(res.url);
      const $ = cheerio.load(res.body);
      $('script,style,noscript').remove();
      const text = $('body').text().replace(/\s+/g, ' ');
      const add = (kind: string, t: string) => { if (t && result.observations.length < 80) result.observations.push({ page: res.url, kind, text: t.slice(0, 220) }); };
      add('title', $('title').first().text().trim());
      add('description', $('meta[name=description]').attr('content') || '');
      for (const m of text.match(/[^.]{0,80}\b(refund|return)s?\b[^.]{0,120}\./gi)?.slice(0, 3) ?? []) add('refund-policy', m.trim());
      for (const m of text.match(/[^.]{0,80}\bcancel(?:lation)?\b[^.]{0,120}\./gi)?.slice(0, 2) ?? []) add('cancellation-policy', m.trim());
      for (const m of text.match(/[^.]{0,60}\b(shipping|delivery)\b[^.]{0,100}\./gi)?.slice(0, 2) ?? []) add('shipping-policy', m.trim());
      for (const m of text.match(/[^.]{0,60}(\d{1,2}% off|coupon|promo code|discount code|stack)[^.]{0,80}/gi)?.slice(0, 4) ?? []) add('discount', m.trim());
      for (const m of text.match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?/g)?.slice(0, 6) ?? []) add('price', m);
      for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)?.slice(0, 2) ?? []) add('contact', m);
      $('a[href]').each((_, el) => {
        try {
          const l = new URL($(el).attr('href')!, res.url);
          l.hash = '';
          if (l.origin === start.origin && INTERESTING.test(l.pathname) && !seen.has(l.toString()) && !queue.includes(l.toString())) queue.push(l.toString());
        } catch { /* ignore bad hrefs */ }
      });
    } catch (e: any) { result.errors.push(`${url}: ${e.message}`); }
  }
  return result;
}

// --------------------------------------------------------------- uploads
const ALLOWED_EXT = ['.json', '.txt', '.md', '.csv', '.ts', '.js'];
export const MAX_UPLOAD_BYTES = 1_000_000;

export function validateUpload(filename: string, buf: Buffer) {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (!/^[\w.\- ()]{1,100}$/.test(filename)) throw new Error('Invalid file name');
  if (!ALLOWED_EXT.includes(ext)) throw new Error(`File type ${ext || '(none)'} is not allowed. Allowed: ${ALLOWED_EXT.join(', ')}`);
  if (buf.length === 0) throw new Error('File is empty');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 1 MB limit');
  if (buf.includes(0)) throw new Error('Binary content is not allowed');
  const text = buf.toString('utf8');
  if (text.includes('�')) throw new Error('File must be valid UTF-8 text');
  if (ext === '.json') { try { JSON.parse(text); } catch { throw new Error('Invalid JSON'); } }
  const lower = filename.toLowerCase();
  const kind = /refund|return/.test(lower) ? 'refund-policy' : /rule|policy|business/.test(lower) ? 'business-rules' : /order|sample/.test(lower) ? 'sample-orders' : /config|\.json/.test(lower) ? 'test-config' : ext === '.ts' || ext === '.js' ? 'source-code (stored for review, never executed)' : 'document';
  return { text, ext, kind, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
