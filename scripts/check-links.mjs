import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);
const markdownFiles = collectMarkdownFiles(root);
const failures = [];
let checkedLinks = 0;

for (const file of markdownFiles) {
  const contents = readFileSync(file, "utf8");
  const links = contents.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);

  for (const match of links) {
    const destination = normalizeDestination(match[1]);
    if (!destination || isExternalDestination(destination)) continue;

    const [relativePath] = destination.split("#", 1);
    if (!relativePath) continue;

    checkedLinks += 1;
    const target = resolve(dirname(file), decodeURIComponent(relativePath));
    if (!existsSync(target)) {
      failures.push(`${relative(root, file)} -> ${destination}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Broken local Markdown links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${checkedLinks} local link${checkedLinks === 1 ? "" : "s"} across ${markdownFiles.length} Markdown files.`,
  );
}

function collectMarkdownFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(path));
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(path);
    }
  }

  return files;
}

function normalizeDestination(value) {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("<")
    ? trimmed.slice(1, trimmed.indexOf(">"))
    : trimmed.split(/\s+["']/u, 1)[0];
  return unwrapped?.replaceAll("\\(", "(").replaceAll("\\)", ")");
}

function isExternalDestination(destination) {
  return /^(?:[a-z][a-z\d+.-]*:|#)/iu.test(destination);
}

function relative(from, to) {
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to;
}
