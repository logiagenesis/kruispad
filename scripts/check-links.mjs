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
const routes = new Set(
  htmlFiles.map((file) => {
    const rel = path.relative(dist, file).replaceAll(path.sep, "/");
    if (rel === "index.html") return "/";
    if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
    return `/${rel}`;
  }),
);

const problems = [];
const hrefRe = /href="([^"]*)"/g;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (!html.includes('lang="af-ZA"')) {
    problems.push(`${file}: missing lang=af-ZA`);
  }
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1];
    if (!href || href === "#") {
      problems.push(`${file}: empty or hash-only href`);
      continue;
    }
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("http")) continue;
    if (href.startsWith("#")) continue;
    const pathname = href.split("#")[0].split("?")[0];
    const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
    const bare = pathname.replace(/\/$/, "") || "/";
    const ok =
      routes.has(normalized) ||
      routes.has(bare === "" ? "/" : `${bare}/`) ||
      routes.has(pathname) ||
      pathname.startsWith("/images/") ||
      pathname.includes(".");
    if (!ok) problems.push(`${file}: unresolved internal href ${href}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`links: ${htmlFiles.length} html files, routes ${[...routes].join(", ") || "(none)"}`);
