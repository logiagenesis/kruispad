#!/usr/bin/env node
/**
 * Generates responsive derivatives for every image in src/data/imageRegistry.ts.
 *
 * - Originals in public/images/source/ are never modified.
 * - Output: public/images/optimized/<id>/<variant>-<width>.<avif|webp|jpg>
 * - A variant may declare a documented manual crop (in source pixels). Without
 *   a crop, the full frame is kept and only resized, so faces are never cut by
 *   the pipeline; framing is then done with object-position in CSS.
 * - Writes src/data/imageManifest.json, which components read for srcsets.
 *
 *   node scripts/optimize-images.mjs [--force]
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { imageRegistry } from '../src/data/imageRegistry.ts';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'public/images/source');
const outDir = path.join(root, 'public/images/optimized');
const force = process.argv.includes('--force');

const FORMATS = [
  { ext: 'avif', opts: { quality: 52, effort: 4 } },
  { ext: 'webp', opts: { quality: 74 } },
  { ext: 'jpg', opts: { quality: 80, mozjpeg: true, progressive: true } },
];

async function mtime(p) {
  try { return (await stat(p)).mtimeMs; } catch { return 0; }
}

const manifest = {};
for (const entry of imageRegistry) {
  const input = path.join(srcDir, entry.file);
  const inputTime = await mtime(input);
  if (!inputTime) throw new Error(`Missing source for ${entry.id}: ${input}`);
  const meta = await sharp(input).metadata();
  const srcW = meta.autoOrient?.width ?? meta.width;
  const srcH = meta.autoOrient?.height ?? meta.height;
  if (srcW !== entry.width || srcH !== entry.height) {
    throw new Error(`${entry.id}: registry says ${entry.width}x${entry.height} but file is ${srcW}x${srcH}`);
  }
  manifest[entry.id] = {};
  for (const variant of entry.variants) {
    const crop = variant.crop ?? null;
    const baseW = crop ? crop.width : srcW;
    const baseH = crop ? crop.height : srcH;
    const widths = [...new Set(variant.widths.filter((w) => w <= baseW).concat(variant.widths.some((w) => w > baseW) ? [baseW] : []))].sort((a, b) => a - b);
    const files = [];
    for (const w of widths) {
      const h = Math.round((baseH * w) / baseW);
      for (const f of FORMATS) {
        if (variant.formats && !variant.formats.includes(f.ext)) continue;
        const rel = `${entry.id}/${variant.name}-${w}.${f.ext}`;
        const out = path.join(outDir, rel);
        if (force || (await mtime(out)) < inputTime) {
          await mkdir(path.dirname(out), { recursive: true });
          let pipe = sharp(input).rotate();
          if (crop) pipe = pipe.extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height });
          pipe = pipe.resize({ width: w, withoutEnlargement: true });
          if (f.ext === 'jpg' && entry.hasAlpha) pipe = pipe.flatten({ background: '#ffffff' });
          await pipe.toFormat(f.ext === 'jpg' ? 'jpeg' : f.ext, f.opts).toFile(out);
        }
        files.push({ path: `images/optimized/${rel}`, width: w, height: h, format: f.ext });
      }
    }
    manifest[entry.id][variant.name] = { width: baseW, height: baseH, files };
  }
  console.log(`ok ${entry.id} (${entry.variants.map((v) => v.name).join(', ')})`);
}

await writeFile(path.join(root, 'src/data/imageManifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${Object.keys(manifest).length} images`);
