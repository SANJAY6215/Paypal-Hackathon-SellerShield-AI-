// Debug helper: prints the elements that cause horizontal overflow at a given viewport. Usage: node overflow-debug.js /defence 1024
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
(async () => {
  const [route, w] = ['/' + (process.argv[2] || 'defence'), Number(process.argv[3] || 1024)];
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: w, height: 900 });
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
  await p.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  await p.goto('http://localhost:3000' + route, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  const out = await p.evaluate(() => {
    const vw = window.innerWidth; const res = [];
    for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.right > vw + 2 && r.width > 0) res.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 70)} right=${Math.round(r.right)} w=${Math.round(r.width)}`); }
    return { vw, scrollW: document.documentElement.scrollWidth, first: res.slice(0, 8) };
  });
  console.log(route, w, JSON.stringify(out, null, 1));
  await b.close();
})();
