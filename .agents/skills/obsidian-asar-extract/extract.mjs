#!/usr/bin/env node
// Extract Obsidian's runtime source from an `.asar` archive into
// `node_modules/.ob-rev-<version>/`, then format the minified JS with oxfmt so
// it can be grepped and read line-by-line for reverse engineering.
//
// This script does NOT hunt the filesystem for the archive — you pass it
// explicitly with --asar. Run with no --asar to print the common per-OS
// locations to copy a path from.
//
//   node .agents/skills/obsidian-asar-extract/extract.mjs --asar <path> [--version <v>] [--out <dir>] [--force]
//
// Both `@electron/asar` and `oxfmt` resolve from the repo's node_modules
// because this file lives under the repo root.

import { extractAll, extractFile, listPackage } from "@electron/asar";
import { format } from "oxfmt";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/** Common places a runtime archive (the one containing app.js) lives, by platform. */
function locationHints() {
  return [
    "Runtime archives contain app.js. The sibling `app.asar` is only the launcher (skip it).",
    "",
    "Auto-updated, newest, per-user:",
    "  macOS   ~/Library/Application Support/obsidian/obsidian-<version>.asar",
    "  Linux   ~/.config/obsidian/obsidian-<version>.asar",
    "  Windows %APPDATA%\\obsidian\\obsidian-<version>.asar",
    "",
    "Bundled with the installed app (installer version, read from its package.json):",
    "  macOS         /Applications/Obsidian.app/Contents/Resources/obsidian.asar",
    "  Windows/Linux <install dir>/resources/obsidian.asar",
    "",
    "GitHub releases (obsidianmd/obsidian-releases) carry `obsidian-<version>.asar.gz`:",
    "  gh release download v<version> --repo obsidianmd/obsidian-releases --pattern '*.asar.gz'",
    "  gunzip obsidian-<version>.asar.gz",
  ].join("\n");
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    asar: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

if (!values.asar) {
  console.error("error: --asar <path> is required.\n");
  console.error(locationHints());
  process.exit(1);
}

const archive = resolve(values.asar);
if (!existsSync(archive)) fail(`asar not found: ${archive}`);

// A runtime archive carries app.js. The launcher app.asar does not — reject it
// early so the agent doesn't analyze the wrong file.
let entries;
try {
  entries = listPackage(archive);
} catch (cause) {
  fail(`not a readable asar archive: ${archive}\n  ${cause.message}`);
}
if (!entries.includes("/app.js")) {
  fail(
    `${archive} has no app.js — this looks like the launcher app.asar, not the runtime.\n\n` +
      locationHints(),
  );
}

// Version is read from the archive's own package.json — the single source of
// truth — so the output directory always matches the runtime it came from.
let version;
try {
  version = JSON.parse(extractFile(archive, "package.json").toString("utf8")).version;
} catch {
  /* fall through to the check below */
}
if (!version) fail("could not read version from the archive's package.json");

const outDir = values.out
  ? resolve(values.out)
  : join(process.cwd(), "node_modules", `.ob-rev-${version}`);

if (existsSync(join(outDir, "app.js")) && !values.force) {
  console.error(`already extracted (use --force to redo): ${outDir}`);
  console.log(outDir);
  process.exit(0);
}

// Guard against a misaimed --out wiping real files: only clear a directory that
// is empty or a prior extraction (carries app.js). Never delete anything else,
// even with --force.
if (existsSync(outDir)) {
  const isPriorExtraction = existsSync(join(outDir, "app.js"));
  if (!isPriorExtraction && readdirSync(outDir).length > 0) {
    fail(`refusing to delete ${outDir}: not empty and not a prior extraction (no app.js).`);
  }
  rmSync(outDir, { recursive: true, force: true });
}
console.error(`extracting ${archive}\n       to ${outDir}`);
extractAll(archive, outDir);

// Format every top-level minified bundle so line-based grep/Read is meaningful.
// lib/ holds vendored deps that the RE workflow rarely needs, so leave it raw.
const topLevelJs = readdirSync(outDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".js"))
  .map((e) => e.name);

for (const name of topLevelJs) {
  const file = join(outDir, name);
  const source = readFileSync(file, "utf8");
  try {
    const { code, errors } = await format(name, source, { semi: true });
    if (errors.length) {
      console.error(`  skip ${name}: ${errors.length} parse error(s), keeping raw`);
      continue;
    }
    writeFileSync(file, code);
    console.error(`  fmt  ${name}`);
  } catch (cause) {
    console.error(`  skip ${name}: ${cause.message}, keeping raw`);
  }
}

console.error(`done. obsidian ${version} source ready.`);
// Machine-readable: the output directory on stdout for the caller to consume.
console.log(outDir);
