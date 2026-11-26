// Renders src/reel.html to a PNG sequence (1080x1920, 30 fps) with headless Chromium.
//   node src/render.mjs --out build/frames [--lang en] [--footage s1,s3] [--workers 3]
//   node src/render.mjs --stills build/preview --at 1.5,4,7,11,16,19.5   (spot-check frames)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// require() (not import) so a globally installed Playwright is found via NODE_PATH
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const FPS = 30, DURATION = 20, TOTAL = FPS * DURATION;
const footage = typeof args.footage === 'string' ? args.footage : '';
const workers = Number(args.workers || 3);

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const query = new URLSearchParams();
if (footage) query.set('footage', footage);
if (typeof args.lang === 'string') query.set('lang', args.lang);
const url = `http://127.0.0.1:${server.address().port}/src/reel.html${query.size ? `?${query}` : ''}`;

const browser = await chromium.launch();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.ready);
  return page;
}
async function shoot(page, t, file) {
  await page.evaluate(t => window.seek(t), t);
  await page.screenshot({ path: file, omitBackground: !!footage, type: 'png' });
}

if (args.stills) {
  fs.mkdirSync(args.stills, { recursive: true });
  const page = await openPage();
  for (const t of String(args.at || '1.5,4,7,11,16,19.5').split(',').map(Number)) {
    await shoot(page, t, path.join(args.stills, `t${t.toFixed(2).padStart(5, '0')}.png`));
  }
} else {
  const out = args.out || path.join(ROOT, 'build/frames');
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now(); let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage();
    for (let f = w; f < TOTAL; f += workers) {
      await shoot(page, f / FPS, path.join(out, `f${String(f).padStart(4, '0')}.png`));
      if (++done % 60 === 0) console.log(`${done}/${TOTAL} frames · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
}
await browser.close();
server.close();
