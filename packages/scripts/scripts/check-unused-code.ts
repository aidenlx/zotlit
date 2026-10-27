#!/usr/bin/env node

// Lint: fails when an export, type or enum member has no reader. knip finds
// them from the entry files in knip.config.ts. The findings that predate this
// check sit in `unused-code.json`; that list only shrinks.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { $ } from "zx";

import { getWorkspaceRoot } from "#package-roots";

const root = await getWorkspaceRoot(import.meta.dirname);
const baselinePath = join(import.meta.dirname, "../unused-code.json");

const TYPES = ["exports", "types", "enumMembers"] as const;
type IssueType = (typeof TYPES)[number];
type Finding = { name: string; namespace?: string; line?: number };
type Row = { file: string } & Partial<Record<IssueType, Finding[]>>;
type Baseline = Record<IssueType, string[]>;

// Vite configs that knip loads print to stdout before the report.
const stdout = (
  await $({
    cwd: root,
    quiet: true,
  })`pnpm exec knip --reporter json --no-exit-code --no-progress --no-config-hints`
).stdout;
const reportLine = stdout
  .split("\n")
  .findLast((line) => line.startsWith('{"issues":'));
if (!reportLine) throw new Error(`knip printed no report:\n${stdout}`);
const rows = (JSON.parse(reportLine) as { issues: Row[] }).issues;

const found = Object.fromEntries(TYPES.map((type) => [type, new Map()])) as {
  [T in IssueType]: Map<string, string>;
};
for (const row of rows)
  for (const type of TYPES)
    for (const symbol of row[type] ?? []) {
      const name = symbol.namespace
        ? `${symbol.namespace}.${symbol.name}`
        : symbol.name;
      found[type].set(`${row.file}: ${name}`, `${row.file}:${symbol.line}`);
    }

const current = Object.fromEntries(
  TYPES.map((type) => [type, [...found[type].keys()].sort()]),
) as Baseline;

if (process.argv.includes("--write-baseline")) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  const counts = TYPES.map((type) => `${current[type].length} ${type}`);
  console.log(`Wrote ${counts.join(", ")} to ${relative(root, baselinePath)}.`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  const added = TYPES.flatMap((type) => {
    const before = new Set(baseline[type]);
    return current[type]
      .filter((key) => !before.has(key))
      .map((key) => `${type}  ${key}  (${found[type].get(key)})`);
  });
  const gone = TYPES.flatMap((type) => {
    const now = new Set(current[type]);
    return baseline[type]
      .filter((key) => !now.has(key))
      .map((key) => `${type}  ${key}`);
  });
  const report = [
    [
      added,
      "These have no reader. Remove each, or read it; a symbol kept for a reader outside the code needs an entry in knip.config.ts:",
    ],
    [
      gone,
      `These have a reader again, or their code is gone. Remove them from ${relative(root, baselinePath)}:`,
    ],
  ] as const;
  for (const [list, heading] of report)
    if (list.length > 0)
      console.error([heading, ...list.map((line) => `  ${line}`)].join("\n"));
  if (report.some(([list]) => list.length > 0)) process.exitCode = 1;
}
