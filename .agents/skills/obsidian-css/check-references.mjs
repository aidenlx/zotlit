#!/usr/bin/env node

// Lists every CSS variable a reference file names that the extracted Obsidian
// build no longer carries. A name counts as carried when `app.css` or `app.js`
// spells it, since Obsidian sets some variables from script.
//
// Usage: node .claude/skills/obsidian-css/check-references.mjs [--obsidian <version>]
// Default version: the newest node_modules/.ob-rev-*/ that holds app.css.
// Exit 0: every name is carried. Exit 1: names listed as file:line. Exit 2: no build.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(skillDir, "../../..");
const modulesDir = join(repoRoot, "node_modules");

const versionFlag = process.argv.indexOf("--obsidian");
const version =
  versionFlag === -1
    ? readdirSync(modulesDir)
        .filter((name) => name.startsWith(".ob-rev-"))
        .map((name) => name.slice(".ob-rev-".length))
        .filter((v) => existsSync(join(modulesDir, `.ob-rev-${v}`, "app.css")))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .at(-1)
    : process.argv[versionFlag + 1];

const buildDir = version && join(modulesDir, `.ob-rev-${version}`);
if (!buildDir || !existsSync(join(buildDir, "app.css"))) {
  console.error(
    "No extracted Obsidian build with app.css. Run /obsidian-asar-extract first.",
  );
  process.exit(2);
}

const shipped = ["app.css", "app.js"]
  .map((file) => join(buildDir, file))
  .filter(existsSync)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const referencesDir = join(skillDir, "references");
const missing = [];
for (const file of readdirSync(referencesDir).filter((f) => f.endsWith(".md"))) {
  const path = join(referencesDir, file);
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      // A table row's first cell names the variable: | `--name` | Use |
      for (const [, name] of line.matchAll(/^\|\s*`(--[\w-]+)`/g)) {
        if (!new RegExp(`${name}(?![\\w-])`).test(shipped))
          missing.push(`${relative(repoRoot, path)}:${index + 1}: ${name}`);
      }
    });
}

if (missing.length === 0) {
  console.log(`Every reference variable is in Obsidian ${version}.`);
} else {
  console.log(
    `${missing.length} reference variable(s) absent from Obsidian ${version}:\n${missing.join("\n")}`,
  );
  process.exit(1);
}
