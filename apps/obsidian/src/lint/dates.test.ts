// The date rule's built-in checks (`dateGlobals`, `dateTypes`, `datePattern`
// in @zotlit/config/oxlint), run through the oxlint binary: RuleTester runs
// plugin rules only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { datePattern, dateGlobals, dateTypes } from "@zotlit/config/oxlint";

const oxlint = join(
  dirname(createRequire(import.meta.url).resolve("oxlint/package.json")),
  "bin/oxlint",
);
const dir = mkdtempSync(join(tmpdir(), "zotlit-date-rule-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(
  join(dir, "oxlint.json"),
  JSON.stringify({
    plugins: ["typescript"],
    categories: { correctness: "off" },
    rules: {
      "no-restricted-globals": ["error", dateGlobals],
      "typescript/no-restricted-types": ["error", dateTypes],
      "no-restricted-imports": ["error", { patterns: [datePattern] }],
    },
  }),
);

const reported = [
  ["new Date(x)", "const at = new Date(millis);", "global"],
  ["Date.now()", "const at = Date.now();", "global"],
  ["Date.parse", 'const at = Date.parse("2024-01-01");', "global"],
  [
    "instanceof Date",
    "const is = (u: unknown) => u instanceof Date;",
    "global",
  ],
  ["globalThis.Date", "const D = globalThis.Date;", "global"],
  ["a Date type", "let at: Date | undefined;", "type"],
  ["a Date type argument", "type Dates = Array<Date>;", "type"],
  ["date-fns", 'import { format } from "date-fns";', "library"],
  [
    "a date-fns subpath",
    'import { addDays } from "date-fns/addDays";',
    "library",
  ],
  ["dayjs", 'import dayjs from "dayjs";', "library"],
  ["a dayjs plugin", 'import utc from "dayjs/plugin/utc";', "library"],
] as const;

const passed = [
  ["Temporal", "const at = Temporal.Instant.from(text);"],
  ["a local named Date", "function at(Date: number) { return Date; }"],
  ["a property named Date", "const at = row.Date;"],
  ["a library that only shares a prefix", 'import x from "dayjsx";'],
] as const;

interface Diagnostic {
  readonly code: string;
  readonly filename: string;
  readonly message: string;
  readonly help?: string;
}

/** Each case's file name, in `dir`. */
const caseFile = (name: string) => `${name.replaceAll(/\W+/g, "-")}.ts`;

/** Every case linted in one oxlint run: the reports per case file, each with its message and help text. */
function lintAll(): ReadonlyMap<string, { code: string; text: string }[]> {
  const files = [...reported, ...passed].map(([name, code]) => {
    writeFileSync(join(dir, caseFile(name)), code);
    return caseFile(name);
  });
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      [oxlint, "-c", "oxlint.json", "--format", "json", ...files],
      { cwd: dir, encoding: "utf8" },
    );
  } catch (error) {
    // oxlint exits 1 when it reports an error.
    output = (error as { stdout: string }).stdout;
  }
  const byFile = new Map<string, { code: string; text: string }[]>();
  for (const { code, filename, message, help } of (
    JSON.parse(output) as { diagnostics: readonly Diagnostic[] }
  ).diagnostics)
    byFile.set(filename, [
      ...(byFile.get(filename) ?? []),
      { code, text: `${message} ${help ?? ""}` },
    ]);
  return byFile;
}

const fix = expect.stringContaining("Temporal outside Effect and DateTime");
const rules = {
  global: "eslint(no-restricted-globals)",
  type: "typescript(no-restricted-types)",
  library: "eslint(no-restricted-imports)",
};
const reports = lintAll();

describe("date rule", () => {
  it.each(reported)("reports %s", (name, _, rule) => {
    expect(reports.get(caseFile(name))).toEqual([
      { code: rules[rule], text: fix },
    ]);
  });

  it.each(passed)("passes %s", (name) => {
    expect(reports.get(caseFile(name))).toBeUndefined();
  });
});
