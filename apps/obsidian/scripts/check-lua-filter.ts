// Drives a native Pandoc over fixture Markdown to check both zotlit-cite.lua
// variants end to end. Run with `pnpm --filter @zotlit/obsidian test:lua-filter`;
// point PANDOC_BIN at another binary to check a second Pandoc version.

import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { CITATION_FRAGMENT_FIXTURES } from "../src/lib/__fixtures__/citation-fragments.ts";
import {
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
  PANDOC_RESOLVE_MAP_FILENAME,
} from "../src/services/pandoc/filter/names.ts";
import { buildFilterVariant } from "./lua-filter.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const filterDir = join(packageRoot, "src/services/pandoc/filter");
const pandocBin = process.env.PANDOC_BIN ?? "pandoc";

/** Fixtures live in the workspace tree, so a failed run leaves them to read. */
const workspaceRoot = join(packageRoot, "tmp/lua-filter");

const REFERENCES = [
  {
    id: "doe2020",
    type: "book",
    title: "A Book",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020]] },
  },
  {
    id: "smith2021",
    type: "book",
    title: "Another Book",
    author: [{ family: "Smith", given: "Ann" }],
    issued: { "date-parts": [[2021]] },
  },
];

const RESOLVE_MAP = {
  citations: {
    "Doe 2020": "doe2020",
    "Doe 2020.md": "doe2020",
    "Smith 2021": "smith2021",
  },
};

const ERROR_MAP = {
  errors: [
    {
      code: "item-not-found",
      linkpath: "Doe 2020",
      message: 'No live Item matches Indexed Key "ABC12345".',
    },
  ],
};

/** Exactly one expectation per case, so the shape says which check runs. */
type Expectation =
  /** Expected substring of the citeproc-rendered plain-text output. */
  | { plain: string }
  /** Substrings the plain-text output must not contain. */
  | { absent: string[] }
  /** Expected substrings of the native AST, rendered without citeproc. */
  | { native: string[] }
  /** Expected substring of stderr; the run must also exit non-zero. */
  | { error: string };

type Case = { name: string; markdown: string } & Expectation;

const CASES: Case[] = [
  { name: "plain wikilink", markdown: "[[Doe 2020]]", plain: "(Doe 2020)" },
  {
    name: "markdown link",
    markdown: "[Doe](Doe%202020.md)",
    plain: "(Doe 2020)",
  },
  { name: "alias", markdown: "[[Doe 2020|Jane's book]]", plain: "(Doe 2020)" },
  {
    name: "citation run",
    markdown: "[[Doe 2020]]; [[Smith 2021]]",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation run without spaces",
    markdown: "[[Doe 2020]];[[Smith 2021]]",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation run leading with author-in-text",
    markdown:
      "see [[Doe 2020#cite:mode=author-in-text&locator=33]]; [[Smith 2021]]",
    plain: "see Doe (2020, 33; Smith 2021)",
  },
  {
    name: "comma is not a citation run",
    markdown: "[[Doe 2020]], [[Smith 2021]]",
    plain: "(Doe 2020), (Smith 2021)",
  },
  {
    name: "a line break ends a citation run",
    markdown: "[[Doe 2020]];\n[[Smith 2021]]",
    plain: "(Doe 2020); (Smith 2021)",
  },
  {
    name: "the same note twice with distinct details",
    markdown:
      "[[Doe 2020#cite:locator=33]]; [[Doe 2020#cite:prefix=compare&locator=40]]",
    plain: "(Doe 2020, 33; compare Doe 2020, 40)",
  },
  {
    name: "citation inside a blockquote",
    markdown: "> quoted [[Doe 2020]]",
    plain: "(Doe 2020)",
  },
  {
    name: "citation inside a list item",
    markdown: "- item [[Doe 2020]]",
    plain: "(Doe 2020)",
  },
  {
    name: "citation inside a heading",
    markdown: "## Background [[Doe 2020]]",
    plain: "Background (Doe 2020)",
  },
  {
    name: "citation run inside emphasis",
    markdown: "*[[Doe 2020]]; [[Smith 2021]]*",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation inside a table cell",
    markdown: "| head |\n| --- |\n| [[Doe 2020]] |",
    plain: "(Doe 2020)",
  },
  {
    name: "an ordinary link stays a link",
    markdown: "[[Some Note]]",
    native: ["Link", '"Some Note"'],
  },
  {
    name: "a heading fragment still cites the Literature Note",
    markdown: "[[Doe 2020#Summary]]",
    plain: "(Doe 2020)",
  },
  {
    name: "an embed never becomes a citation",
    markdown: "![[Doe 2020]]",
    absent: ["(Doe 2020)"],
  },
  {
    name: "an ordinary link breaks a citation run",
    markdown: "[[Doe 2020]]; [[Some Note]]; [[Smith 2021]]",
    plain: "(Doe 2020); Some Note; (Smith 2021)",
  },
  {
    name: "author-in-text after the first run position",
    markdown: "[[Doe 2020]]; [[Smith 2021#cite:mode=author-in-text]]",
    error: "only the first position in a Citation Run",
  },
  {
    name: "cite intent on a note that is not a Literature Note",
    markdown: "[[Some Note#cite:locator=3]]",
    error: "unresolved-citation-intent",
  },
  {
    name: "a bad fragment inside a heading stops the run",
    markdown: "## Background [[Doe 2020#cite:page=1]]",
    error: '"page" is not a Citation Fragment parameter',
  },
  {
    name: "every error in one run",
    markdown: "[[Doe 2020#cite:locator=]] and [[Doe 2020#cite:page=1]]",
    error: "stopped on 2 error(s)",
  },
  {
    name: "a link that breaks a citation run reports one error",
    markdown: "[[Doe 2020]]; [[Doe 2020#cite:page=1]]",
    error: "stopped on 1 error(s)",
  },
];

// Fragment cases come from the corpus the TypeScript parser also runs, so the
// two implementations cannot drift.
for (const fixture of CITATION_FRAGMENT_FIXTURES) {
  if (fixture.fragment === null) continue;
  const markdown = `[[Doe 2020#cite:${fixture.fragment}]]`;
  CASES.push(
    fixture.error
      ? { name: fixture.name, markdown, error: fixture.error }
      : { name: fixture.name, markdown, plain: fixture.plain! },
  );
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function pandoc(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Run {
  const result = spawnSync(pandocBin, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const failures: string[] = [];

/** One per named check the run executes, so the tally follows the code. */
let checks = 0;

function fail(name: string, mismatch: string, actual: string): void {
  failures.push(`${name}\n  ${mismatch}\n  actual: ${actual.trim()}`);
}

function check(name: string, actual: string, ...expected: string[]): void {
  for (const wanted of expected) {
    if (actual.includes(wanted)) continue;
    fail(name, `expected: ${wanted}`, actual);
  }
}

function checkAbsent(
  name: string,
  actual: string,
  ...unwanted: string[]
): void {
  for (const text of unwanted) {
    if (!actual.includes(text)) continue;
    fail(name, `unexpected: ${text}`, actual);
  }
}

/** The run had to succeed; `false` once the failure is recorded. */
function checkRan(name: string, run: Run): boolean {
  if (run.status === 0) return true;
  failures.push(`${name}\n  pandoc failed: ${run.stderr.trim()}`);
  return false;
}

/** The run had to stop; `false` once the failure is recorded. */
function checkStopped(name: string, run: Run): boolean {
  if (run.status !== 0) return true;
  failures.push(
    `${name}\n  expected a non-zero exit, got output: ${run.stdout.trim()}`,
  );
  return false;
}

/** Pandoc wraps plain output, so every assertion runs against one flat line. */
function flatten(text: string): string {
  return text.replaceAll(/\s+/g, " ");
}

async function main(): Promise<void> {
  const version = pandoc(["--version"], { cwd: packageRoot });
  if (version.status !== 0) {
    throw new Error(
      `Could not run "${pandocBin}". Install Pandoc 3.1.1 or newer, or set PANDOC_BIN.`,
    );
  }
  console.log(version.stdout.split("\n")[0]);

  await rm(workspaceRoot, { recursive: true, force: true });
  await mkdir(workspaceRoot, { recursive: true });
  // Realpath, so the paths this script asserts on match the ones Pandoc resolves.
  const workspace = await realpath(workspaceRoot);

  await writeFile(
    join(workspace, "references.json"),
    JSON.stringify(REFERENCES),
  );
  await writeMap(workspace, RESOLVE_MAP);
  await writeFile(
    join(workspace, PANDOC_DEFAULTS_FILENAME),
    await readFilterFile(PANDOC_DEFAULTS_FILENAME),
  );
  await writeFile(
    join(workspace, PANDOC_FILTER_FILENAME),
    buildFilterVariant(await readFilterFile(PANDOC_FILTER_FILENAME), "sandbox"),
  );

  for (const testCase of CASES) await runCase(workspace, testCase);
  await checkEmptyErrors(workspace);
  await checkMapErrors(workspace);
  await checkCliVariant(workspace);

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} failure(s):\n\n${failures.join("\n\n")}`,
    );
    console.error(`\nfixtures kept at ${workspace}`);
    process.exitCode = 1;
    return;
  }
  await rm(workspace, { recursive: true, force: true });
  console.log(`${checks} checks passed`);
}

function readFilterFile(name: string): Promise<string> {
  return readFile(join(filterDir, name), "utf8");
}

function writeMap(directory: string, payload: unknown): Promise<void> {
  return writeFile(
    join(directory, PANDOC_RESOLVE_MAP_FILENAME),
    JSON.stringify(payload),
  );
}

/** The defaults file locates the filter beside it, so the run needs no filter flag. */
function convert(workspace: string, input = "input.md"): Run {
  return pandoc(
    [
      input,
      "--defaults",
      join(workspace, PANDOC_DEFAULTS_FILENAME),
      "--bibliography",
      "references.json",
      "--to",
      "plain",
    ],
    { cwd: workspace },
  );
}

async function runCase(workspace: string, testCase: Case): Promise<void> {
  checks += 1;
  await writeFile(join(workspace, "input.md"), `${testCase.markdown}\n`);

  if ("native" in testCase) {
    // Native AST assertions skip citeproc, which would consume the Cite nodes.
    const run = pandoc(
      [
        "input.md",
        "--from",
        "markdown+wikilinks_title_after_pipe",
        "--lua-filter",
        join(workspace, PANDOC_FILTER_FILENAME),
        "--to",
        "native",
      ],
      { cwd: workspace },
    );
    if (!checkRan(testCase.name, run)) return;
    check(testCase.name, flatten(run.stdout), ...testCase.native);
    return;
  }

  const run = convert(workspace);
  if ("error" in testCase) {
    if (!checkStopped(testCase.name, run)) return;
    check(testCase.name, run.stderr, testCase.error);
    return;
  }
  if (!checkRan(testCase.name, run)) return;
  const output = flatten(run.stdout);
  if ("plain" in testCase) check(testCase.name, output, testCase.plain);
  else checkAbsent(testCase.name, output, ...testCase.absent);
}

/** An empty errors array reports nothing, so the conversion goes ahead. */
async function checkEmptyErrors(workspace: string): Promise<void> {
  checks += 1;
  const name = "an empty errors array converts as usual";
  await writeFile(join(workspace, "input.md"), "[[Doe 2020]]\n");
  await writeMap(workspace, { ...RESOLVE_MAP, errors: [] });
  const run = convert(workspace);
  await writeMap(workspace, RESOLVE_MAP);

  if (!checkRan(name, run)) return;
  check(name, flatten(run.stdout), "(Doe 2020)");
}

/** An error payload in the resolve map stops the run before any conversion. */
async function checkMapErrors(workspace: string): Promise<void> {
  checks += 1;
  const name = "resolve map errors abort the run";
  await writeFile(join(workspace, "input.md"), "[[Doe 2020]]\n");
  await writeMap(workspace, ERROR_MAP);
  const run = convert(workspace);
  await writeMap(workspace, RESOLVE_MAP);

  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[item-not-found]");
}

/** Where the CLI variant runs, against a stub `obsidian` on PATH. */
interface Cli {
  workspace: string;
  notes: string;
  /** The stub answers with this file and records how it was invoked. */
  response: string;
  callLog: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Builds a notes directory holding the CLI variant, plus a stub `obsidian` that
 * records how it was invoked so the vault-targeting contract stays checked.
 */
async function setupCli(workspace: string): Promise<Cli> {
  const notes = join(workspace, "notes");
  const bin = join(workspace, "bin");
  const callLog = join(workspace, "obsidian-call.txt");
  const response = join(workspace, "obsidian-response.json");
  await mkdir(notes, { recursive: true });
  await mkdir(bin, { recursive: true });

  const stub = join(bin, "obsidian");
  await writeFile(
    stub,
    [
      "#!/bin/sh",
      `printf '%s|%s\\n' "$PWD" "$*" > "${callLog}"`,
      `exec cat "${response}"`,
      "",
    ].join("\n"),
  );
  await chmod(stub, 0o755);

  await writeFile(join(notes, "input.md"), "[[Doe 2020#cite:locator=33]]\n");
  await writeFile(
    join(notes, PANDOC_FILTER_FILENAME),
    buildFilterVariant(await readFilterFile(PANDOC_FILTER_FILENAME), "cli"),
  );
  await writeFile(
    join(notes, PANDOC_DEFAULTS_FILENAME),
    await readFilterFile(PANDOC_DEFAULTS_FILENAME),
  );

  return {
    workspace,
    notes,
    response,
    callLog,
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  };
}

/**
 * Run from the workspace with a relative input, so the filter has to resolve the
 * absolute path and switch into the input's directory itself.
 */
function runCli(cli: Cli): Run {
  return pandoc(
    [
      "notes/input.md",
      "--defaults",
      join(cli.notes, PANDOC_DEFAULTS_FILENAME),
      "--bibliography",
      "references.json",
      "--to",
      "plain",
    ],
    { cwd: cli.workspace, env: cli.env },
  );
}

async function checkCliVariant(workspace: string): Promise<void> {
  const cli = await setupCli(workspace);
  await checkCliResolves(cli);
  await checkCliErrorPayload(cli);
  await checkCliCallFails(cli);
}

async function checkCliResolves(cli: Cli): Promise<void> {
  checks += 1;
  const name = "cli variant calls zotlit:resolve";
  await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));

  const run = runCli(cli);
  if (!checkRan(name, run)) return;
  check(name, flatten(run.stdout), "(Doe 2020, 33)");

  const call = await readFile(cli.callLog, "utf8");
  check(name, call, `zotlit:resolve file=${join(cli.notes, "input.md")}`);
  check(name, call, `${cli.notes}|`);
}

async function checkCliErrorPayload(cli: Cli): Promise<void> {
  checks += 1;
  const name = "cli variant aborts on an error payload";
  await writeFile(cli.response, JSON.stringify(ERROR_MAP));

  const run = runCli(cli);
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[item-not-found]");
}

/** A non-zero `obsidian` exit is what a closed vault or disabled CLI looks like. */
async function checkCliCallFails(cli: Cli): Promise<void> {
  checks += 1;
  const name = "cli variant aborts when the resolve call fails";
  await rm(cli.response, { force: true });

  const run = runCli(cli);
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[resolve-call-failed]");
}

await main();
