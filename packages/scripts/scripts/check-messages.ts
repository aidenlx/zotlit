#!/usr/bin/env node

// Lint: fails when a message key in `messages/en.json` has no reader. Tests,
// generated code, and the catalogs themselves read no key. The keys unused
// before this check existed sit in `unused-messages.json`; that list only
// shrinks.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  compareWithBaseline,
  messageKeys,
  unusedMessageKeys,
} from "#message-usage";
import { getWorkspaceRoot } from "#package-roots";

const root = await getWorkspaceRoot(import.meta.dirname);
const baselinePath = join(import.meta.dirname, "../unused-messages.json");

const SOURCES = [
  "apps/*/{src,content,scripts,addon}/**/*.{ts,tsx,mts,js,mjs,mdx,xhtml,html}",
  "packages/*/{src,scripts}/**/*.{ts,tsx,mts,js,mjs}",
];
const READS_NO_KEY = [
  "**/node_modules/**",
  "**/dist/**",
  "**/generated/**",
  "**/paraglide/**",
  "**/*.test.*",
  "packages/e2e/**",
];

const files = globSync(SOURCES, { cwd: root, exclude: READS_NO_KEY });
const keys = messageKeys(
  JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8")) as Record<
    string,
    unknown
  >,
);
const unused = unusedMessageKeys(
  keys,
  files.map((file) => readFileSync(join(root, file), "utf8")),
);

if (process.argv.includes("--write-baseline")) {
  writeFileSync(baselinePath, `${JSON.stringify(unused, null, 2)}\n`);
  console.log(
    `Wrote ${unused.length} keys to ${relative(root, baselinePath)}.`,
  );
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as string[];
  const { added, used, gone } = compareWithBaseline(unused, baseline, keys);
  const report = [
    [
      added,
      "These message keys have no reader. Remove each from every locale in messages/, or use it:",
    ],
    [
      used,
      `These keys have a reader again. Remove them from ${relative(root, baselinePath)}:`,
    ],
    [
      gone,
      `The catalog no longer holds these keys. Remove them from ${relative(root, baselinePath)}:`,
    ],
  ] as const;
  for (const [list, heading] of report)
    if (list.length > 0)
      console.error([heading, ...list.map((key) => `  ${key}`)].join("\n"));
  if (report.some(([list]) => list.length > 0)) process.exitCode = 1;
}
