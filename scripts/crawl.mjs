#!/usr/bin/env node
/**
 * Slow, polite crawl of the live WordPress site.
 * Saves raw responses and derived inventories under artifacts/kruispad-audit/.
 *
 *   node scripts/crawl.mjs            # full crawl
 *   node scripts/crawl.mjs --no-media # skip binary downloads
 *
 * No content is invented here: every value written to an inventory comes
 * from a fetched response.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const ORIGIN = 'https://www.kruispadhazeldean.co.za';
const HOST_RE = /^(https?:)?\/\/(www\.)?kruispadhazeldean\.co\.za/i;
const OUT = path.resolve('artifacts/kruispad-audit');
const RAW = path.join(OUT, 'raw');
const ASSETS = path.join(OUT, 'assets');
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS ?? 1200);
const SKIP_MEDIA = process.argv.includes('--no-media');

// Routes supplied in the brief. They are crawled explicitly so that the
// audit can confirm or refute each one against the live site.
const BRIEF_ROUTES = [
  '/', '/home/kruispad-erediens/', '/cafe-berea/', '/groepe/', '/odos-kidz/',
  '/meer-oor-ons/', '/meer-oor-ons/droom-van-kruispad/', '/meer-oor-ons/span/',
  '/groepe/organisasies/', '/dien/elios/', '/dien/kairos/',
  '/preke-en-media/fred-suzi/', '/preke-en-media/preke/', '/2026-kalender/',
  '/home/bydraes/', '/home/kontak-ons/', '/dien/',
];
const BRIEF_ALIASES = [
  '/preke-en-media/kruispad-erediens/', '/preke-en-media/cafe-berea/',
  '/home/odos-kidz/', '/meer-oor-ons/organisasies/', '/droom-vir-kruispad/',
  '/?page_id=485', '/meer-oor-ons/organisasies/elios/', '/meer-oor-ons/organisasies/kairos/',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function ensureDirs() {
  for (const d of [RAW, path.join(RAW, 'html'), path.join(RAW, 'rest'), path.join(RAW, 'sitemaps'), ASSETS]) {
    await mkdir(d, { recursive: true });
  }
}

// The live host sits behind Imunify360 bot protection, which answers plain
// HTTP clients with a JS challenge ("One moment, please..."). We therefore
// drive a real Chromium: a page solves the challenge once, and the browser
// context's request API (which shares cookies) does the actual fetching.
let browser;
let ctx;
let challengePage;
const CHALLENGE_RE = /Imunify360|One moment, please|bot-protection|imunify/i;

async function initBrowser() {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ locale: 'af-ZA', viewport: { width: 1440, height: 900 } });
  challengePage = await ctx.newPage();
  await solveChallenge(ORIGIN + '/');
}

async function solveChallenge(url) {
  log(`  solving bot challenge via browser: ${url}`);
  await challengePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  for (let i = 0; i < 30; i++) {
    const html = await challengePage.content().catch(() => '');
    if (!CHALLENGE_RE.test(html.slice(0, 5000)) && html.length > 2000) return true;
    await sleep(1000);
  }
  log('  challenge did not clear within 30s');
  return false;
}

function wrapResponse(r, url) {
  return {
    status: r.status(),
    ok: r.ok(),
    url: r.url() || url,
    headers: { get: (k) => r.headers()[k.toLowerCase()] ?? null, all: () => r.headers() },
    text: () => r.text(),
    arrayBuffer: async () => (await r.body()),
  };
}

let lastRequest = 0;
async function politeFetch(url, opts = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = lastRequest + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const r = await ctx.request.fetch(url, {
        maxRedirects: opts.redirect === 'manual' ? 0 : 20,
        headers: { accept: opts.accept ?? '*/*' },
        timeout: 60000,
      });
      const res = wrapResponse(r, url);
      const ct = res.headers.get('content-type') ?? '';
      if (/text\/html/.test(ct) && res.status !== 404) {
        const body = await r.text();
        if (CHALLENGE_RE.test(body.slice(0, 5000)) && body.length < 20000) {
          log(`  challenge page on ${url}, attempt ${attempt}`);
          await solveChallenge(url);
          continue;
        }
      }
      if (res.status === 429 || res.status >= 500) {
        log(`  ${res.status} on ${url}, retry ${attempt}`);
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      log(`  network error on ${url}: ${err.message}, retry ${attempt}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error(`Failed after retries: ${url}`);
}

function slugFor(urlPath) {
  const clean = urlPath.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, (m) => m.replace(/[^a-z0-9]/gi, '_'));
  const s = clean.replace(/^\/|\/$/g, '').replace(/\//g, '__');
  return s || 'home-root';
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  await writeFile(path.join(OUT, file), lines.join('\n') + '\n');
  log(`wrote ${file} (${rows.length} rows)`);
}

function normaliseInternal(href, base) {
  try {
    const u = new URL(href, base);
    if (!HOST_RE.test(u.origin)) return null;
    u.hash = '';
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function classifyLink(href) {
  const h = href.trim();
  if (!h) return 'empty';
  if (h.startsWith('#')) return 'anchor';
  if (/^mailto:/i.test(h)) return 'mailto';
  if (/^tel:/i.test(h)) return 'tel';
  if (/wa\.me|whatsapp\.com|api\.whatsapp/i.test(h)) return 'whatsapp';
  if (/^javascript:/i.test(h)) return 'javascript';
  if (/drive\.google\.com|docs\.google\.com|forms\.gle/i.test(h)) return 'google-drive';
  if (/\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)/i.test(h)) return 'download';
  if (HOST_RE.test(h) || h.startsWith('/')) return 'internal';
  if (/^https?:/i.test(h)) return 'external';
  return 'other';
}

// ---------------------------------------------------------------- robots + sitemaps
async function crawlRobotsAndSitemaps() {
  const robotsRes = await politeFetch(`${ORIGIN}/robots.txt`);
  const robots = await robotsRes.text();
  await writeFile(path.join(RAW, 'robots.txt'), robots);
  log(`robots.txt ${robotsRes.status}`);

  const sitemapSeeds = new Set([...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]));
  for (const s of ['/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml']) sitemapSeeds.add(ORIGIN + s);

  const seen = new Set();
  const urls = new Map(); // loc -> {sitemap, lastmod}
  const sitemapLog = [];
  const queue = [...sitemapSeeds];
  while (queue.length) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const res = await politeFetch(sm);
    const body = await res.text();
    sitemapLog.push({ url: sm, status: res.status, finalUrl: res.url, contentType: res.headers.get('content-type') });
    if (!res.ok || !/<(urlset|sitemapindex)/i.test(body)) continue;
    await writeFile(path.join(RAW, 'sitemaps', slugFor(new URL(sm).pathname + new URL(sm).search) + '.xml'), body);
    const $ = cheerio.load(body, { xmlMode: true });
    $('sitemap > loc').each((_, el) => queue.push($(el).text().trim()));
    $('url').each((_, el) => {
      const loc = $(el).find('loc').first().text().trim();
      if (loc) urls.set(loc, { sitemap: sm, lastmod: $(el).find('lastmod').first().text().trim() });
    });
  }
  await writeFile(path.join(RAW, 'sitemaps', '_index.json'), JSON.stringify({ sitemaps: sitemapLog, urls: Object.fromEntries(urls) }, null, 2));
  log(`sitemaps: ${sitemapLog.length} fetched, ${urls.size} URLs`);
  return { robots, sitemapUrls: urls, sitemapLog };
}

// ---------------------------------------------------------------- REST API
async function fetchRestCollection(type, extraQuery = '') {
  const all = [];
  const log_ = [];
  for (let page = 1; page < 100; page++) {
    const url = `${ORIGIN}/wp-json/wp/v2/${type}?per_page=100&page=${page}${extraQuery}`;
    const res = await politeFetch(url, { accept: 'application/json' });
    const text = await res.text();
    log_.push({ url, status: res.status, total: res.headers.get('x-wp-total'), totalPages: res.headers.get('x-wp-totalpages') });
    await writeFile(path.join(RAW, 'rest', `${type}-page-${page}.json`), text);
    if (!res.ok) break;
    let data;
    try { data = JSON.parse(text); } catch { break; }
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    const totalPages = Number(res.headers.get('x-wp-totalpages') ?? 1);
    if (page >= totalPages) break;
  }
  log(`REST ${type}: ${all.length} items`);
  return { items: all, log: log_ };
}

async function crawlRest() {
  const rootRes = await politeFetch(`${ORIGIN}/wp-json/`, { accept: 'application/json' });
  await writeFile(path.join(RAW, 'rest', 'root.json'), await rootRes.text());
  const pages = await fetchRestCollection('pages');
  const posts = await fetchRestCollection('posts');
  const media = await fetchRestCollection('media');
  const categories = await fetchRestCollection('categories');
  const menus = await fetchRestCollection('menu-items').catch(() => ({ items: [], log: [] }));
  await writeFile(path.join(RAW, 'rest', '_log.json'), JSON.stringify({ pages: pages.log, posts: posts.log, media: media.log, categories: categories.log, menus: menus.log }, null, 2));
  return { pages: pages.items, posts: posts.items, media: media.items };
}

// ---------------------------------------------------------------- HTML pages
function extractPage($, pageUrl) {
  const out = {
    lang: $('html').attr('lang') ?? '',
    title: $('title').first().text().trim(),
    metaDescription: $('meta[name="description"]').attr('content') ?? '',
    canonical: $('link[rel="canonical"]').attr('href') ?? '',
    ogImage: $('meta[property="og:image"]').attr('content') ?? '',
    generator: $('meta[name="generator"]').map((_, e) => $(e).attr('content')).get().join(' | '),
    bodyClass: $('body').attr('class') ?? '',
    headings: [],
    links: [],
    images: [],
    iframes: [],
    forms: [],
    videos: [],
    text: '',
  };
  $('h1,h2,h3,h4').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) out.headings.push({ level: el.tagName, text: t });
  });
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    out.links.push({
      href: href ?? '',
      hasHref: href !== undefined,
      text: $(el).text().replace(/\s+/g, ' ').trim(),
      ariaLabel: $(el).attr('aria-label') ?? '',
      target: $(el).attr('target') ?? '',
      kind: href === undefined ? 'no-href' : classifyLink(href),
      inNav: $(el).closest('nav, .main-navigation, #site-navigation').length > 0,
      inFooter: $(el).closest('footer, .site-footer').length > 0,
    });
  });
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('src') || '';
    out.images.push({
      src: src ? new URL(src, pageUrl).href : '',
      srcset: $el.attr('data-srcset') || $el.attr('srcset') || '',
      alt: $el.attr('alt'),
      width: $el.attr('width') ?? '',
      height: $el.attr('height') ?? '',
      className: $el.attr('class') ?? '',
      context: 'img',
      parentClass: $el.parent().attr('class') ?? '',
    });
  });
  // Inline background images (Elementor frequently puts them in style attrs or <style> blocks).
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      out.images.push({ src: new URL(m[1], pageUrl).href, srcset: '', alt: undefined, width: '', height: '', className: $(el).attr('class') ?? '', context: 'inline-bg', parentClass: '' });
    }
  });
  $('style').each((_, el) => {
    const css = $(el).html() ?? '';
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp|gif|svg|avif))['"]?\s*\)/gi)) {
      out.images.push({ src: new URL(m[1], pageUrl).href, srcset: '', alt: undefined, width: '', height: '', className: '', context: 'style-block-bg', parentClass: '' });
    }
  });
  $('[data-settings]').each((_, el) => {
    const s = $(el).attr('data-settings') ?? '';
    for (const m of s.matchAll(/"url":"([^"]+?\.(?:jpe?g|png|webp|gif|mp4|webm))"/gi)) {
      const u = m[1].replace(/\\\//g, '/');
      out.images.push({ src: new URL(u, pageUrl).href, srcset: '', alt: undefined, width: '', height: '', className: $(el).attr('class') ?? '', context: 'elementor-settings', parentClass: '' });
    }
    for (const m of s.matchAll(/"background_video_link":"([^"]+)"/gi)) {
      out.videos.push({ src: m[1].replace(/\\\//g, '/'), context: 'elementor-bg-video' });
    }
  });
  $('iframe').each((_, el) => {
    out.iframes.push({ src: $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-load') || '', title: $(el).attr('title') ?? '' });
  });
  $('video, video source').each((_, el) => {
    const src = $(el).attr('src');
    if (src) out.videos.push({ src: new URL(src, pageUrl).href, context: 'video' });
  });
  $('[data-settings*="youtube"], .elementor-widget-video').each((_, el) => {
    const s = $(el).attr('data-settings') ?? '';
    for (const m of s.matchAll(/"youtube_url":"([^"]+)"/g)) out.videos.push({ src: m[1].replace(/\\\//g, '/'), context: 'elementor-video-widget' });
  });
  $('form').each((_, el) => {
    out.forms.push({
      action: $(el).attr('action') ?? '',
      method: $(el).attr('method') ?? '',
      fields: $(el).find('input,select,textarea').map((_, f) => $(f).attr('name') || $(f).attr('type')).get(),
    });
  });
  const $body = $('body').clone();
  $body.find('script,style,noscript,svg').remove();
  out.text = $body.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return out;
}

async function fetchPage(route) {
  const url = route.startsWith('http') ? route : ORIGIN + route;
  // First, record redirect chain manually.
  const chain = [];
  let current = url;
  let res;
  for (let hop = 0; hop < 10; hop++) {
    res = await politeFetch(current, { redirect: 'manual', accept: 'text/html' });
    chain.push({ url: current, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).href;
      continue;
    }
    break;
  }
  const html = await res.text();
  return { requested: url, finalUrl: current, status: res.status, chain, html, headers: res.headers.all() };
}

// ---------------------------------------------------------------- media downloads
async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function downloadAsset(url, filename) {
  const dest = path.join(ASSETS, filename);
  if (await exists(dest)) {
    const buf = await readFile(dest);
    return { dest, bytes: buf.length, sha256: sha256(buf), status: 'cached' };
  }
  const res = await politeFetch(url);
  if (!res.ok) return { dest: '', bytes: 0, sha256: '', status: `http-${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  // GitHub rejects files over 100 MB; record but do not store them.
  if (buf.length > 95 * 1024 * 1024) return { dest: '', bytes: buf.length, sha256: sha256(buf), status: 'too-large-not-stored' };
  await writeFile(dest, buf);
  return { dest, bytes: buf.length, sha256: sha256(buf), status: 'downloaded' };
}

function safeName(s) {
  return s.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 140);
}

// ---------------------------------------------------------------- main
async function main() {
  await ensureDirs();
  const startedAt = new Date().toISOString();
  await initBrowser();

  const { sitemapUrls } = await crawlRobotsAndSitemaps();
  const rest = await crawlRest();

  // Route set = sitemap ∪ REST links ∪ brief routes ∪ brief aliases.
  const routeSources = new Map();
  const addRoute = (r, src) => {
    const p = normaliseInternal(r, ORIGIN);
    if (!p) return;
    if (!routeSources.has(p)) routeSources.set(p, new Set());
    routeSources.get(p).add(src);
  };
  for (const loc of sitemapUrls.keys()) addRoute(loc, 'sitemap');
  for (const p of rest.pages) addRoute(p.link, 'rest-page');
  for (const p of rest.posts) addRoute(p.link, 'rest-post');
  for (const r of BRIEF_ROUTES) addRoute(r, 'brief-route');
  for (const r of BRIEF_ALIASES) addRoute(r, 'brief-alias');

  const pages = [];
  const discovered = new Set();
  const queue = [...routeSources.keys()];
  const done = new Set();
  while (queue.length) {
    const route = queue.shift();
    if (done.has(route)) continue;
    done.add(route);
    // Do not crawl binaries or wp-admin/json as pages.
    if (/\/wp-(admin|json|content|includes)\//.test(route) || /\.(jpe?g|png|gif|webp|pdf|mp4|xml|svg|zip|docx?)$/i.test(route)) continue;
    log(`page ${route}`);
    const r = await fetchPage(route);
    const slug = slugFor(route);
    await writeFile(path.join(RAW, 'html', `${slug}.html`), r.html);
    const $ = cheerio.load(r.html);
    const data = extractPage($, r.finalUrl);
    await writeFile(path.join(RAW, 'html', `${slug}.text.txt`), data.text);
    const record = { route, slug, sources: [...(routeSources.get(route) ?? ['discovered-link'])], ...r, html: undefined, ...data };
    pages.push(record);
    // Queue internal links discovered in content (only same-host, HTML-ish).
    for (const l of data.links) {
      if (l.kind !== 'internal') continue;
      const p = normaliseInternal(l.href, r.finalUrl);
      if (!p || done.has(p) || /\/(feed|comments)\/|\?replytocom|\/wp-login|\/xmlrpc/.test(p)) continue;
      if (!routeSources.has(p)) {
        routeSources.set(p, new Set(['discovered-link']));
        discovered.add(p);
        queue.push(p);
      }
    }
  }
  await writeFile(path.join(RAW, 'pages.json'), JSON.stringify(pages, null, 2));
  const home = pages.find((p) => p.route === '/');
  if (!home || home.status !== 200 || CHALLENGE_RE.test(home.title)) {
    throw new Error(`Homepage not crawled cleanly (status ${home?.status}, title "${home?.title}") — bot protection likely still active. Not writing inventories.`);
  }

  // ---- page inventory
  const restByLink = new Map();
  for (const p of rest.pages) restByLink.set(normaliseInternal(p.link, ORIGIN), { type: 'page', ...p });
  for (const p of rest.posts) restByLink.set(normaliseInternal(p.link, ORIGIN), { type: 'post', ...p });
  await writeCsv('page-inventory.csv', pages.map((p) => {
    const rp = restByLink.get(p.route);
    return {
      route: p.route,
      sources: p.sources.join('|'),
      http_status: p.status,
      redirect_chain: p.chain.map((c) => `${c.status} ${c.url}`).join(' -> '),
      final_url: p.finalUrl,
      wp_type: rp?.type ?? '',
      wp_id: rp?.id ?? '',
      wp_status: rp?.status ?? '',
      wp_parent: rp?.parent ?? '',
      wp_modified: rp?.modified ?? '',
      wp_template: rp?.template ?? '',
      html_lang: p.lang,
      title: p.title,
      meta_description: p.metaDescription,
      canonical: p.canonical,
      og_image: p.ogImage,
      h1: p.headings.filter((h) => h.level === 'h1').map((h) => h.text).join(' | '),
      headings: p.headings.map((h) => `${h.level}:${h.text}`).join(' | '),
      word_count: p.text.split(/\s+/).filter(Boolean).length,
      images: p.images.length,
      links: p.links.length,
      iframes: p.iframes.map((i) => i.src).join(' | '),
      videos: p.videos.map((v) => v.src).join(' | '),
      forms: p.forms.length,
      raw_html: `raw/html/${p.slug}.html`,
      text_file: `raw/html/${p.slug}.text.txt`,
    };
  }), ['route', 'sources', 'http_status', 'redirect_chain', 'final_url', 'wp_type', 'wp_id', 'wp_status', 'wp_parent', 'wp_modified', 'wp_template', 'html_lang', 'title', 'meta_description', 'canonical', 'og_image', 'h1', 'headings', 'word_count', 'images', 'links', 'iframes', 'videos', 'forms', 'raw_html', 'text_file']);

  // ---- link inventory (dedupe per page+href+text)
  const linkRows = [];
  for (const p of pages) {
    if (p.status >= 300) continue; // redirect/404 bodies are not site content
    const seen = new Set();
    for (const l of p.links) {
      const key = `${l.href}|${l.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      linkRows.push({ page: p.route, kind: l.kind, href: l.href, text: l.text, aria_label: l.ariaLabel, target: l.target, in_nav: l.inNav, in_footer: l.inFooter });
    }
    for (const i of p.iframes) linkRows.push({ page: p.route, kind: 'iframe', href: i.src, text: i.title, aria_label: '', target: '', in_nav: false, in_footer: false });
    for (const v of p.videos) linkRows.push({ page: p.route, kind: 'video', href: v.src, text: v.context, aria_label: '', target: '', in_nav: false, in_footer: false });
    for (const f of p.forms) linkRows.push({ page: p.route, kind: 'form', href: f.action, text: f.fields.join(' '), aria_label: '', target: '', in_nav: false, in_footer: false });
  }
  await writeCsv('link-inventory.csv', linkRows, ['page', 'kind', 'href', 'text', 'aria_label', 'target', 'in_nav', 'in_footer']);

  // ---- media downloads + inventory
  const mediaRows = [];
  const mediaBySrc = new Map();
  for (const m of rest.media) {
    const src = m.source_url;
    const filename = `${m.id}_${safeName(path.basename(new URL(src).pathname))}`;
    let dl = { dest: '', bytes: '', sha256: '', status: 'skipped' };
    if (!SKIP_MEDIA) dl = await downloadAsset(src, filename);
    const w = m.media_details?.width ?? '';
    const h = m.media_details?.height ?? '';
    const row = {
      id: m.id,
      filename,
      source_url: src,
      mime: m.mime_type,
      width: w,
      height: h,
      orientation: w && h ? (w > h * 1.05 ? 'landscape' : h > w * 1.05 ? 'portrait' : 'square') : '',
      alt_text: m.alt_text ?? '',
      title: m.title?.rendered ?? '',
      caption: cheerio.load(m.caption?.rendered ?? '').text().trim(),
      post_parent: m.post ?? '',
      date: m.date,
      bytes: dl.bytes,
      sha256: dl.sha256,
      download: dl.status,
      local_path: dl.dest ? path.relative(OUT, dl.dest) : '',
      used_on: '',
    };
    mediaRows.push(row);
    mediaBySrc.set(src.replace(/^https?:\/\/(www\.)?/, ''), row);
  }

  // ---- image usage (per page) and non-library assets
  const usageRows = [];
  const extraAssets = new Map();
  const stripSize = (u) => u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '').replace(/-scaled(?=\.[a-z]+$)/i, '');
  for (const p of pages) {
    if (p.status >= 300) continue;
    for (const img of p.images) {
      if (!img.src || img.src.startsWith('data:')) continue;
      const key = img.src.replace(/^https?:\/\/(www\.)?/, '');
      let media = mediaBySrc.get(key);
      if (!media) {
        const base = stripSize(key);
        for (const [k, v] of mediaBySrc) if (stripSize(k) === base || k.replace(/-scaled(?=\.[a-z]+$)/i, '') === base) { media = v; break; }
      }
      if (media) media.used_on = [...new Set([...(media.used_on ? media.used_on.split('|') : []), p.route])].join('|');
      else if (HOST_RE.test(img.src) || /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(img.src)) extraAssets.set(img.src, (extraAssets.get(img.src) ?? new Set()).add(p.route));
      usageRows.push({
        page: p.route,
        context: img.context,
        src: img.src,
        media_id: media?.id ?? '',
        media_filename: media?.filename ?? '',
        natural_width: media?.width ?? '',
        natural_height: media?.height ?? '',
        orientation: media?.orientation ?? '',
        page_alt: img.alt === undefined ? '(no alt attr)' : img.alt,
        library_alt: media?.alt_text ?? '',
        attr_width: img.width,
        attr_height: img.height,
        class: img.className,
        parent_class: img.parentClass,
      });
    }
  }
  for (const [src, routes] of extraAssets) {
    let dl = { dest: '', bytes: '', sha256: '', status: 'skipped' };
    const filename = `ext_${sha256(src).slice(0, 8)}_${safeName(path.basename(new URL(src).pathname))}`;
    if (!SKIP_MEDIA) dl = await downloadAsset(src, filename).catch((e) => ({ dest: '', bytes: '', sha256: '', status: `error ${e.message}` }));
    mediaRows.push({ id: '', filename, source_url: src, mime: '', width: '', height: '', orientation: '', alt_text: '', title: '(not in media library)', caption: '', post_parent: '', date: '', bytes: dl.bytes, sha256: dl.sha256, download: dl.status, local_path: dl.dest ? path.relative(OUT, dl.dest) : '', used_on: [...routes].join('|') });
  }
  // Downloadable documents linked from pages.
  for (const l of linkRows.filter((r) => r.kind === 'download')) {
    const src = new URL(l.href, ORIGIN).href;
    if (mediaRows.some((m) => m.source_url === src)) continue;
    let dl = { dest: '', bytes: '', sha256: '', status: 'skipped' };
    const filename = `doc_${sha256(src).slice(0, 8)}_${safeName(path.basename(new URL(src).pathname))}`;
    if (!SKIP_MEDIA && HOST_RE.test(src)) dl = await downloadAsset(src, filename).catch((e) => ({ dest: '', bytes: '', sha256: '', status: `error ${e.message}` }));
    mediaRows.push({ id: '', filename, source_url: src, mime: '', width: '', height: '', orientation: '', alt_text: '', title: '(linked document)', caption: '', post_parent: '', date: '', bytes: dl.bytes, sha256: dl.sha256, download: dl.status, local_path: dl.dest ? path.relative(OUT, dl.dest) : '', used_on: l.page });
  }
  await writeCsv('media-inventory.csv', mediaRows, ['id', 'filename', 'source_url', 'mime', 'width', 'height', 'orientation', 'alt_text', 'title', 'caption', 'post_parent', 'date', 'bytes', 'sha256', 'download', 'local_path', 'used_on']);
  await writeCsv('image-usage.csv', usageRows, ['page', 'context', 'src', 'media_id', 'media_filename', 'natural_width', 'natural_height', 'orientation', 'page_alt', 'library_alt', 'attr_width', 'attr_height', 'class', 'parent_class']);

  // ---- contact facts (everything found, with where it was found)
  const facts = { generatedAt: new Date().toISOString(), emails: {}, phones: {}, whatsapp: {}, social: {}, addresses: {}, times: {}, googleDrive: {}, bank: {} };
  const add = (bucket, value, route) => {
    const v = value.trim();
    if (!v) return;
    (facts[bucket][v] ??= new Set()).add(route);
  };
  for (const p of pages) {
    if (p.status >= 300) continue;
    const text = p.text;
    for (const m of text.matchAll(/[A-Z0-9._%+-]+\s?@\s?[A-Z0-9.-]+\.[A-Z]{2,}/gi)) add('emails', m[0], p.route);
    for (const m of text.matchAll(/(\+27|0)\s?\d{2}\s?\d{3}\s?\d{4}/g)) add('phones', m[0], p.route);
    for (const m of text.matchAll(/[^\n]*(Kantoor|Gebou|Silver Lakes|Von Backstrom|Curro|Hazeldean Primary|0081)[^\n]*/gi)) add('addresses', m[0].slice(0, 300), p.route);
    for (const m of text.matchAll(/[^\n]*\b\d{1,2}[:h]\d{2}\b[^\n]*/g)) add('times', m[0].slice(0, 300), p.route);
    for (const m of text.matchAll(/[^\n]*(Standard Bank|Rek(ening)?\s*(nr|no)?\.?\s*[:\d]|Tak(kode)?\s*[:\d]|SnapScan)[^\n]*/gi)) add('bank', m[0].slice(0, 300), p.route);
    for (const l of p.links) {
      if (l.kind === 'mailto') add('emails', `mailto-href: ${l.href}`, p.route);
      if (l.kind === 'tel') add('phones', `tel-href: ${l.href}`, p.route);
      if (l.kind === 'whatsapp') add('whatsapp', l.href, p.route);
      if (l.kind === 'google-drive') add('googleDrive', `${l.href} [${l.text}]`, p.route);
      if (/facebook\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com/i.test(l.href)) add('social', l.href, p.route);
    }
  }
  const serialisable = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, typeof v === 'string' ? v : Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, [...vv].sort()]))]));
  await writeFile(path.join(OUT, 'contact-facts.json'), JSON.stringify(serialisable, null, 2));

  await writeFile(path.join(OUT, 'crawl-summary.json'), JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    origin: ORIGIN,
    delayMs: DELAY_MS,
    sitemapUrls: sitemapUrls.size,
    restPages: rest.pages.length,
    restPosts: rest.posts.length,
    restMedia: rest.media.length,
    htmlFetched: pages.length,
    discoveredViaLinks: [...discovered],
    statuses: Object.fromEntries(pages.map((p) => [p.route, p.status])),
  }, null, 2));
  await browser.close();
  log('crawl complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
