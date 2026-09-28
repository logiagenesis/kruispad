import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src");
const problems = [];

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

const files = (await walk(src)).filter((file) => /\.(astro|ts|mjs|css)$/.test(file));
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (text.includes("href=\"\"") || text.includes("href=''")) {
    problems.push(`${path.relative(root, file)}: empty href`);
  }
  if (/\blang=["']en-US["']/.test(text)) {
    problems.push(`${path.relative(root, file)}: lang is en-US`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`lint: ${files.length} source files ok`);
