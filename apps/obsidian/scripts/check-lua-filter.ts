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
import "./source-alias.ts";

// The `zotlit:csl` answers this script replies with come from the resolver the
// plugin itself runs, so the materialized file native Pandoc cites with is the
// one an installed ZotLit produces. Both are reached after the alias hook is
// registered, and the style validator reads XML through the parser Obsidian's
// renderer supplies.
const { Window } = await import("happy-dom");
Object.assign(globalThis, { DOMParser: new Window().DOMParser });
const { materializeCslStyle, resolveCslStyle } =
  await import("../src/services/pandoc/csl.ts");
const { resolveInstalledStyle } =
  await import("../src/services/pandoc/styles.ts");

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

/** doe2020 with an issue month, which each locale renders in its own language. */
const CSL_REFERENCES = [
  {
    id: "doe2020",
    type: "book",
    title: "A Book",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020, 3]] },
  },
];

const CSL_PARENT = "http://www.zotero.org/styles/journal";
const CSL_DEPENDENT = "http://www.zotero.org/styles/journal-german";
const CSL_MISSING = "http://www.zotero.org/styles/uninstalled";

/**
 * Renders a fixed word and the issue month, so one rendered entry says both
 * which style formatted it and which locale it was formatted in.
 */
const CSL_PARENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Journal</title>
    <id>${CSL_PARENT}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number" prefix="[" suffix="]"/></layout></citation>
  <bibliography>
    <layout>
      <text value="journal"/>
      <date variable="issued" prefix=" ">
        <date-part name="month" form="long"/>
      </date>
    </layout>
  </bibliography>
</style>`;

/** A dependent style: an alias for its parent, save for the locale it sets. */
const CSL_DEPENDENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Journal (German)</title>
    <id>${CSL_DEPENDENT}</id>
    <link href="${CSL_PARENT}" rel="independent-parent"/>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
</style>`;

/** A style file of the user's own, which Pandoc opens without ZotLit reading it. */
const PANDOC_OWNED_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Pandoc owned</title>
    <id>http://example.com/styles/pandoc-owned</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text value="pandoc-owned-citation"/></layout></citation>
  <bibliography><layout><text value="pandoc-owned-entry"/></layout></bibliography>
</style>`;

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
  /** The stub answers `zotlit:resolve` with this file. */
  response: string;
  /** The stub answers `zotlit:csl` with this file. */
  cslResponse: string;
  callLog: string;
  /** The Zotero data directory the installed styles sit in. */
  dataDir: string;
  /** Where a materialized Resolved CSL Style lands. */
  store: string;
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
  const cslResponse = join(workspace, "obsidian-csl-response.json");
  const dataDir = join(workspace, "zotero");
  const styles = join(dataDir, "styles");
  await mkdir(notes, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(join(styles, "hidden"), { recursive: true });

  const stub = join(bin, "obsidian");
  await writeFile(
    stub,
    [
      "#!/bin/sh",
      `printf '%s|%s\\n' "$PWD" "$*" >> "${callLog}"`,
      'case "$1" in',
      `zotlit:csl) exec cat "${cslResponse}" ;;`,
      `*) exec cat "${response}" ;;`,
      "esac",
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

  // One Zotero install of a dependent style and its independent parent, one
  // bibliography whose issue month a locale renders, and one style file the
  // user owns.
  await writeFile(join(styles, "hidden", "journal.csl"), CSL_PARENT_STYLE);
  await writeFile(join(styles, "journal-german.csl"), CSL_DEPENDENT_STYLE);
  await writeFile(
    join(workspace, "csl-references.json"),
    JSON.stringify(CSL_REFERENCES),
  );
  await writeFile(join(workspace, "pandoc-owned.csl"), PANDOC_OWNED_STYLE);

  return {
    workspace,
    notes,
    response,
    cslResponse,
    callLog,
    dataDir,
    store: join(workspace, "csl-store"),
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  };
}

/**
 * Run from the workspace with a relative input, so the filter has to resolve the
 * absolute path and switch into the input's directory itself. The call log
 * starts empty, so each run is read on its own.
 */
async function runCli(
  cli: Cli,
  {
    bibliography = "references.json",
    to = "plain",
    standalone = false,
    csl,
  }: {
    bibliography?: string;
    to?: string;
    standalone?: boolean;
    /** A style file the user passes on the command line, as `--csl` does. */
    csl?: string;
  } = {},
): Promise<Run> {
  await rm(cli.callLog, { force: true });
  return pandoc(
    [
      "notes/input.md",
      "--defaults",
      join(cli.notes, PANDOC_DEFAULTS_FILENAME),
      "--bibliography",
      bibliography,
      "--to",
      to,
      ...(standalone ? ["--standalone"] : []),
      ...(csl === undefined ? [] : ["--csl", csl]),
    ],
    { cwd: cli.workspace, env: cli.env },
  );
}

async function checkCliVariant(workspace: string): Promise<void> {
  const cli = await setupCli(workspace);
  await checkCliResolves(cli);
  await checkCliErrorPayload(cli);
  await checkDependentStyle(cli);
  await checkDocumentLanguage(cli);
  await checkPandocOwnedStyle(cli);
  await checkStyleAmbiguity(cli);
  await checkCommandLineStyle(cli);
  await checkUninstalledStyle(cli);
  await checkCliCallFails(cli);
}

async function checkCliResolves(cli: Cli): Promise<void> {
  checks += 1;
  const name = "cli variant calls zotlit:resolve";
  await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));

  const run = await runCli(cli);
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

  const run = await runCli(cli);
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[item-not-found]");
}

/** A non-zero `obsidian` exit is what a closed vault or disabled CLI looks like. */
async function checkCliCallFails(cli: Cli): Promise<void> {
  checks += 1;
  const name = "cli variant aborts when the resolve call fails";
  await writeFile(
    join(cli.notes, "input.md"),
    "[[Doe 2020#cite:locator=33]]\n",
  );
  await rm(cli.response, { force: true });

  const run = await runCli(cli);
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[resolve-call-failed]");
}

/**
 * Answers `zotlit:csl` with what the plugin's own resolver produces for
 * `styleId`, so citeproc opens the file an installed ZotLit would materialize.
 */
async function installCslResponse(cli: Cli, styleId: string): Promise<void> {
  const response = await resolveCslStyle(styleId, {
    resolve: (requested) =>
      resolveInstalledStyle(cli.dataDir, { styleId: requested }),
    materialize: (xml) => materializeCslStyle(xml, cli.store),
  });
  await writeFile(cli.cslResponse, JSON.stringify(response));
}

/** One document that selects a Zotero-installed style, in the notes directory. */
async function writeStyledInput(
  cli: Cli,
  properties: readonly string[],
): Promise<void> {
  await writeFile(
    join(cli.notes, "input.md"),
    ["---", ...properties, "---", "", "[[Doe 2020]]", ""].join("\n"),
  );
  await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));
}

/**
 * The whole native chain: the filter resolves `zotlit-csl` through the shared
 * resolver, and citeproc formats with the file it answers — the parent's
 * layout under the dependent style's own default locale.
 */
async function checkDependentStyle(cli: Cli): Promise<void> {
  checks += 1;
  const name = "a dependent zotlit-csl style renders through its parent";
  await writeStyledInput(cli, [`zotlit-csl: ${CSL_DEPENDENT}`]);
  await installCslResponse(cli, CSL_DEPENDENT);

  const run = await runCli(cli, { bibliography: "csl-references.json" });
  if (!checkRan(name, run)) return;
  check(name, flatten(run.stdout), "[1]", "journal März");
  check(
    name,
    await readFile(cli.callLog, "utf8"),
    `zotlit:csl style=${CSL_DEPENDENT}`,
  );
}

/** ZotLit resolves the style and leaves the document language alone. */
async function checkDocumentLanguage(cli: Cli): Promise<void> {
  checks += 1;
  const name = "the filter preserves document lang";
  await writeStyledInput(cli, [`zotlit-csl: ${CSL_DEPENDENT}`, "lang: en-GB"]);
  await installCslResponse(cli, CSL_DEPENDENT);

  // Standalone Markdown carries the document metadata this check reads, and
  // `-citations` keeps the citeproc-rendered text in the output: with that
  // extension on, Pandoc 3.1.1 writes citations back in `[@key]` syntax.
  const run = await runCli(cli, {
    bibliography: "csl-references.json",
    to: "markdown-citations",
    standalone: true,
  });
  if (!checkRan(name, run)) return;
  check(name, run.stdout, "lang: en-GB");
  // The style resolved, and the document's own language governs citeproc over
  // the locale that style declares.
  check(name, flatten(run.stdout), "journal March");
  checkAbsent(name, run.stdout, "zotlit-csl:");
}

/** A sole standard `csl` belongs to Pandoc, which opens it without ZotLit. */
async function checkPandocOwnedStyle(cli: Cli): Promise<void> {
  checks += 1;
  const name = "a sole csl property stays Pandoc's own";
  await writeStyledInput(cli, [
    `csl: ${join(cli.workspace, "pandoc-owned.csl")}`,
  ]);
  await rm(cli.cslResponse, { force: true });

  const run = await runCli(cli, { bibliography: "csl-references.json" });
  if (!checkRan(name, run)) return;
  check(name, flatten(run.stdout), "pandoc-owned-citation");
  checkAbsent(name, await readFile(cli.callLog, "utf8"), "zotlit:csl");
}

/** Two style declarations name two owners, so the run stops instead of choosing. */
async function checkStyleAmbiguity(cli: Cli): Promise<void> {
  checks += 1;
  const name = "csl and zotlit-csl together stop the run";
  await writeStyledInput(cli, [
    `csl: ${join(cli.workspace, "pandoc-owned.csl")}`,
    `zotlit-csl: ${CSL_DEPENDENT}`,
  ]);
  await installCslResponse(cli, CSL_DEPENDENT);

  const run = await runCli(cli, { bibliography: "csl-references.json" });
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[csl-ambiguous]", '"csl"', '"zotlit-csl"');
}

/** `--csl` reaches the filter as document metadata, so the same rule applies. */
async function checkCommandLineStyle(cli: Cli): Promise<void> {
  checks += 1;
  const name = "a --csl option and zotlit-csl together stop the run";
  await writeStyledInput(cli, [`zotlit-csl: ${CSL_DEPENDENT}`]);
  await installCslResponse(cli, CSL_DEPENDENT);

  const run = await runCli(cli, {
    bibliography: "csl-references.json",
    csl: join(cli.workspace, "pandoc-owned.csl"),
  });
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[csl-ambiguous]");
}

/** The resolver's own diagnosis reaches the Pandoc run that asked for it. */
async function checkUninstalledStyle(cli: Cli): Promise<void> {
  checks += 1;
  const name = "an uninstalled zotlit-csl style stops the run";
  await writeStyledInput(cli, [`zotlit-csl: ${CSL_MISSING}`]);
  await installCslResponse(cli, CSL_MISSING);

  const run = await runCli(cli, { bibliography: "csl-references.json" });
  if (!checkStopped(name, run)) return;
  check(name, run.stderr, "[style-missing]", CSL_MISSING);
}

await main();
