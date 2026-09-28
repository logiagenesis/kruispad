import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const htmlFiles = (await walk(dist)).filter((file) => file.endsWith(".html"));
const problems = [];
const imgRe = /<img\b[^>]*>/g;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  for (const tag of html.match(imgRe) ?? []) {
    const alt = tag.match(/\balt="([^"]*)"/);
    if (!alt || alt[1].trim() === "") problems.push(`${file}: image missing alt\n${tag}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`alt: all images in ${htmlFiles.length} html files have alt text`);
