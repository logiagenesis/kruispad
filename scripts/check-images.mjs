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
    const src = tag.match(/\bsrc="([^"]*)"/)?.[1] ?? "";
    if (!src) problems.push(`${file}: img without src`);
    if (src.startsWith("data:")) continue;
    const rel = src.replace(/^https?:\/\/[^/]+/, "").replace(/^\/kruispad\//, "").replace(/^\//, "");
    const disk = path.join(dist, rel.split("?")[0]);
    try {
      await readFile(disk);
    } catch {
      problems.push(`${file}: missing image file ${src}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`images: referenced files exist in ${htmlFiles.length} html files`);
