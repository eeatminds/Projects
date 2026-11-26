// Renders every creative in creatives.html to PNG.
// Usage: node render.mjs [id ...]      (no ids = all)
// Output: out/en/<id>_<size>.png  — sq 1080x1080, fd 1080x1350 (4:5), st 1080x1920 (9:16)
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'en');
fs.mkdirSync(outDir, { recursive: true });

const SIZES = { sq: [1080, 1080], fd: [1080, 1350], st: [1080, 1920] };
const page_url = pathToFileURL(path.join(here, 'creatives.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(page_url);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => window.__IDS);

const problems = [];
for (const id of ids) {
  for (const [size, [w, h]] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${page_url}?id=${id}&size=${size}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const urls = [...document.querySelectorAll('[style*="background-image"]')]
        .map(el => getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1]).filter(Boolean);
      await Promise.all([...urls.map(u => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = u; })),
        ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]);
    });
    // Overflow check: content that spills out of its box, or story content in the bottom safe zone.
    const issues = await page.evaluate(({ size }) => {
      const out = [];
      const cr = document.querySelector('.cr').getBoundingClientRect();
      const box = document.querySelector('.panel, .qwrap');
      for (const el of box.querySelectorAll('*')) {
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push('h-scroll ' + el.className);
      }
      const panel = document.querySelector('.panel');
      if (panel && panel.scrollHeight > panel.clientHeight + 1) out.push(`panel overflow ${panel.scrollHeight - panel.clientHeight}px`);
      const q = document.querySelector('.qwrap'), band = document.querySelector('.band');
      if (q && band) {
        const last = q.lastElementChild.getBoundingClientRect().bottom;
        const top = band.getBoundingClientRect().top;
        if (last > top - 16) out.push(`quote collides with band by ${Math.round(last - top + 16)}px`);
      }
      const limit = size === 'st' ? 1920 - 360 : cr.bottom;
      const cta = document.querySelector('.cta').getBoundingClientRect();
      if (cta.bottom > limit) out.push(`CTA in unsafe zone (bottom ${Math.round(cta.bottom)})`);
      return out;
    }, { size });
    if (issues.length) problems.push(`${id}_${size}: ${issues.join('; ')}`);
    await page.screenshot({ path: path.join(outDir, `${id}_${size}.png`), clip: { x: 0, y: 0, width: w, height: h } });
    process.stdout.write('.');
  }
}
await browser.close();
console.log(`\nrendered ${ids.length * 3} files to ${path.relative(process.cwd(), outDir)}`);
if (problems.length) { console.log('LAYOUT ISSUES:\n' + problems.join('\n')); process.exitCode = 1; }
