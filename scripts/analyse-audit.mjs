#!/usr/bin/env node
/**
 * Offline analysis of the saved crawl (no network).
 *
 * Inputs:  artifacts/kruispad-audit/raw/{pages.json, html/*.html, rendered-images.json}
 *          artifacts/kruispad-audit/media-inventory.csv
 * Outputs: raw/html/<slug>.text.txt   (block-separated visible text)
 *          contact-facts.json          (every contact fact + where it appears + known-error checks)
 *          image-crop-risk.csv         (rendered box vs natural ratio, per viewport)
 *
 *   node scripts/analyse-audit.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const OUT = path.resolve('artifacts/kruispad-audit');
const RAW = path.join(OUT, 'raw');
const pages = JSON.parse(await readFile(path.join(RAW, 'pages.json'), 'utf8')).filter((p) => p.status === 200);

const BLOCKS = 'p,div,li,h1,h2,h3,h4,h5,h6,section,article,header,footer,td,th,tr,ul,ol,figure,figcaption,nav,a,button,label,span.elementor-icon-list-text,span.elementor-button-text';

function visibleText(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,template').remove();
  $('br').replaceWith('\n');
  $(BLOCKS).each((_, el) => { $(el).append('\n'); });
  return $('body').text().replace(/[ \t ]+/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ------------------------------------------------------------------ facts
const facts = {
  generatedAt: new Date().toISOString(),
  note: 'Derived from saved raw HTML of HTTP-200 pages. Values are verbatim; routes list every page where the value appears.',
  emailsInText: {}, mailtoHrefs: {}, phonesInText: {}, telHrefs: {}, whatsappHrefs: {}, whatsappInText: {},
  socialHrefs: {}, googleDriveHrefs: {}, externalHrefs: {}, addressLines: {}, timeLines: {}, bankLines: {},
  knownErrorChecks: {},
};
const add = (bucket, value, route) => {
  const v = String(value).trim();
  if (!v) return;
  (facts[bucket][v] ??= new Set()).add(route);
};

const ERROR_PATTERNS = {
  'christiaan@kruispadhazelden.co.za (wrong domain)': /christiaan@kruispadhazelden\.co\.za/i,
  'christiaan@kruispadhazeldea.co.za (truncated domain)': /christiaan@kruispadhazeldea\.co\.za/i,
  'admin@ kruispadhazeldean.co.za (space)': /admin@\s+kruispadhazeldean/i,
  '"Kruipad Finansies" (typo)': /Kruipad Finansies/i,
  'doubled WhatsApp URL': /chat\.whatsapp\.com\/https?:\/\/chat\.whatsapp\.com/i,
  'boxout calendar link': /boxout-web-za-gebeure-kalender/i,
  'html lang="en-US"': /<html[^>]*lang="en-US"/i,
  '"Proudly powered by WordPress" footer credit': /Proudly powered by WordPress/i,
};
const errorHits = Object.fromEntries(Object.keys(ERROR_PATTERNS).map((k) => [k, new Set()]));

for (const p of pages) {
  const html = await readFile(path.join(RAW, 'html', `${p.slug}.html`), 'utf8');
  const text = visibleText(html);
  await writeFile(path.join(RAW, 'html', `${p.slug}.text.txt`), text + '\n');
  const route = p.route;

  for (const [label, re] of Object.entries(ERROR_PATTERNS)) if (re.test(html) || re.test(text)) errorHits[label].add(route);

  for (const m of text.matchAll(/[A-Z0-9._%+-]+@\s?[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi)) add('emailsInText', m[0], route);
  for (const m of text.matchAll(/(?:\+27|\b0)\s?\d{2}\s?\d{3}\s?\d{4}\b/g)) add('phonesInText', m[0], route);
  for (const m of text.matchAll(/chat\.whatsapp\.com\/\S+|wa\.me\/\S+/gi)) add('whatsappInText', m[0], route);

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const ctx = () => lines.slice(Math.max(0, i - 1), i + 3).join(' / ');
    if (/Kantoor \d|Gebou|Silver Lakes|Silverlakes|Von Backstrom|Curro|Hazeldean Primary|\b0081\b/i.test(line)) add('addressLines', ctx(), route);
    if (/\b\d{1,2}[:h]\d{2}\b/.test(line)) add('timeLines', ctx(), route);
    if (/Standard Bank|Rekening|\bRek\b|\bTak\b|Takkode|SnapScan|verwysing/i.test(line)) add('bankLines', ctx(), route);
  });

  const $ = cheerio.load(html);
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (/^mailto:/i.test(href)) add('mailtoHrefs', href, route);
    else if (/^tel:/i.test(href)) add('telHrefs', href, route);
    else if (/whatsapp|wa\.me/i.test(href)) add('whatsappHrefs', href, route);
    else if (/drive\.google|docs\.google|forms\.gle/i.test(href)) add('googleDriveHrefs', `${href} [${label}]`, route);
    else if (/facebook\.com|instagram\.com|youtube\.com|youtu\.be|tiktok|twitter\.com/i.test(href)) add('socialHrefs', href, route);
    else if (/^https?:/i.test(href) && !/kruispadhazeldean\.co\.za/i.test(href)) add('externalHrefs', href, route);
  });
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src) add('externalHrefs', `iframe: ${src}`, route);
  });
}
for (const [k, v] of Object.entries(errorHits)) facts.knownErrorChecks[k] = [...v].sort();

const serial = Object.fromEntries(Object.entries(facts).map(([k, v]) => {
  if (typeof v !== 'object' || k === 'knownErrorChecks') return [k, v];
  return [k, Object.fromEntries(Object.entries(v).sort().map(([kk, s]) => [kk, [...s].sort()]))];
}));
await writeFile(path.join(OUT, 'contact-facts.json'), JSON.stringify(serial, null, 2) + '\n');
console.log('wrote contact-facts.json');

// ------------------------------------------------------------------ crop risk
const rendered = JSON.parse(await readFile(path.join(RAW, 'rendered-images.json'), 'utf8'));
const media = (await readFile(path.join(OUT, 'media-inventory.csv'), 'utf8')).split('\n');
const header = media.shift().split(',');
const parseCsvLine = (line) => {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
};
const mediaRows = media.filter(Boolean).map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [header[i], v])));
const baseName = (u) => decodeURIComponent(u.split('?')[0].split('/').pop() ?? '')
  .replace(/-rb7[a-z0-9]+|-p3[a-z0-9]+|-[a-z0-9]{40,}/i, '')
  .replace(/-\d+x\d+(?=\.[a-z]+$)/i, '').replace(/-scaled(?=\.[a-z]+$)/i, '').replace(/-scaled(?=-)/i, '').toLowerCase();
const mediaByBase = new Map();
for (const m of mediaRows) if (m.source_url) mediaByBase.set(baseName(m.source_url), m);

const rows = [];
for (const [route, byVp] of Object.entries(rendered)) {
  for (const [vp, list] of Object.entries(byVp)) {
    if (!Array.isArray(list)) continue;
    for (const img of list) {
      if (!img.src || img.boxW < 40 || img.boxH < 40) continue;
      const m = mediaByBase.get(baseName(img.src));
      const origW = Number(m?.width) || img.naturalW || 0;
      const origH = Number(m?.height) || img.naturalH || 0;
      const boxRatio = img.boxW / img.boxH;
      const srcRatio = origW && origH ? origW / origH : 0;
      const mode = img.kind === 'img' ? img.objectFit : img.backgroundSize;
      const covers = img.kind === 'img' ? img.objectFit === 'cover' : /cover/.test(img.backgroundSize ?? '');
      let croppedPct = 0;
      if (covers && srcRatio) croppedPct = Math.round((1 - Math.min(boxRatio, srcRatio) / Math.max(boxRatio, srcRatio)) * 100);
      // Elementor thumbs are pre-cropped files: compare original to the thumb itself.
      const preCropped = img.kind === 'img' && img.naturalW && img.naturalH && srcRatio && Math.abs(img.naturalW / img.naturalH - srcRatio) > 0.08;
      if (preCropped) croppedPct = Math.max(croppedPct, Math.round((1 - Math.min(img.naturalW / img.naturalH, srcRatio) / Math.max(img.naturalW / img.naturalH, srcRatio)) * 100));
      const risk = croppedPct >= 50 ? 'HIGH' : croppedPct >= 25 ? 'MEDIUM' : croppedPct > 0 ? 'LOW' : 'none';
      rows.push({
        route, viewport: vp, kind: img.kind, src: img.src, media_id: m?.id ?? '', original: origW && origH ? `${origW}x${origH}` : '',
        original_orientation: m?.orientation ?? '', rendered_box: `${img.boxW}x${img.boxH}`, fit: mode ?? '', position: img.objectPosition ?? img.backgroundPosition ?? '',
        pre_cropped_file: preCropped ? 'yes' : '', est_hidden_pct: croppedPct, risk, alt: img.alt ?? '',
      });
    }
  }
}
const cols = ['route', 'viewport', 'kind', 'src', 'media_id', 'original', 'original_orientation', 'rendered_box', 'fit', 'position', 'pre_cropped_file', 'est_hidden_pct', 'risk', 'alt'];
await writeFile(path.join(OUT, 'image-crop-risk.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
console.log(`wrote image-crop-risk.csv (${rows.length} rows, ${rows.filter((r) => r.risk === 'HIGH').length} HIGH)`);
