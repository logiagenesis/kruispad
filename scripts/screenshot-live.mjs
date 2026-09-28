#!/usr/bin/env node
/**
 * Desktop + mobile full-page screenshots of the LIVE WordPress site, plus a
 * record of how every image is rendered (natural vs rendered box, object-fit,
 * background-size). Used to document the current cropping problems.
 *
 *   node scripts/screenshot-live.mjs
 * Reads routes from artifacts/kruispad-audit/raw/pages.json (run crawl first).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('artifacts/kruispad-audit');
const ORIGIN = 'https://www.kruispadhazeldean.co.za';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const pages = JSON.parse(await readFile(path.join(OUT, 'raw/pages.json'), 'utf8'));
const routes = pages.filter((p) => p.status === 200).map((p) => p.route);

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const rendered = {};

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  await mkdir(path.join(OUT, 'screenshots', name), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch ?? false, locale: 'af-ZA' });
  const page = await ctx.newPage();
  for (const route of routes) {
    const slug = route.replace(/^\/|\/$/g, '').replace(/[/?=&]/g, '__') || 'home-root';
    try {
      await page.goto(ORIGIN + route, { waitUntil: 'networkidle', timeout: 60000 });
      // Imunify360 serves a JS challenge first; wait for the real page.
      for (let i = 0; i < 30; i++) {
        const t = await page.title();
        if (!/One moment|Imunify|Access denied/i.test(t)) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      // Trigger lazy-loaded images.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, 'screenshots', name, `${slug}.jpg`), fullPage: true, type: 'jpeg', quality: 78 });
      const imgs = await page.evaluate(() => {
        const out = [];
        for (const img of document.querySelectorAll('img')) {
          const r = img.getBoundingClientRect();
          const cs = getComputedStyle(img);
          out.push({ kind: 'img', src: img.currentSrc || img.src, alt: img.getAttribute('alt'), naturalW: img.naturalWidth, naturalH: img.naturalHeight, boxW: Math.round(r.width), boxH: Math.round(r.height), top: Math.round(r.top + scrollY), objectFit: cs.objectFit, objectPosition: cs.objectPosition });
        }
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (!cs.backgroundImage || cs.backgroundImage === 'none' || !cs.backgroundImage.includes('url(')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 20) continue;
          out.push({ kind: 'background', src: cs.backgroundImage.replace(/^url\(["']?|["']?\)$/g, ''), alt: null, boxW: Math.round(r.width), boxH: Math.round(r.height), top: Math.round(r.top + scrollY), backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, className: el.className?.toString?.() ?? '' });
        }
        return out;
      });
      (rendered[route] ??= {})[name] = imgs;
      console.log(name, route, 'ok', imgs.length, 'images');
    } catch (err) {
      console.log(name, route, 'FAILED', err.message);
      (rendered[route] ??= {})[name] = { error: err.message };
    }
  }
  await ctx.close();
}
await browser.close();
await writeFile(path.join(OUT, 'raw/rendered-images.json'), JSON.stringify(rendered, null, 2));
console.log('done');
