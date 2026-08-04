// Drives a native Pandoc over fixture Markdown to check both zotlit-cite.lua
// variants end to end. Run with `pnpm --filter @zotlit/obsidian test:lua-filter`;
// point PANDOC_BIN at another binary to check a second Pandoc version.

import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildFilterVariant } from "./lua-filter.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const filterDir = join(packageRoot, "src/services/pandoc/filter");
const pandocBin = process.env.PANDOC_BIN ?? "pandoc";

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

interface Case {
  name: string;
  markdown: string;
  /** Expected substring of the citeproc-rendered plain-text output. */
  plain?: string;
  /** Substrings the plain-text output must not contain. */
  absent?: string[];
  /** Expected substrings of the native AST, rendered without citeproc. */
  native?: string[];
  /** Expected substring of stderr; the run must also exit non-zero. */
  error?: string;
}

const CASES: Case[] = [
  { name: "plain wikilink", markdown: "[[Doe 2020]]", plain: "(Doe 2020)" },
  {
    name: "markdown link",
    markdown: "[Doe](Doe%202020.md)",
    plain: "(Doe 2020)",
  },
  { name: "alias", markdown: "[[Doe 2020|Jane's book]]", plain: "(Doe 2020)" },
  {
    name: "locator",
    markdown: "[[Doe 2020#cite:locator=33]]",
    plain: "(Doe 2020, 33)",
  },
  {
    name: "label and locator",
    markdown: "[[Doe 2020#cite:label=chapter&locator=3]]",
    plain: "(Doe 2020, chap. 3)",
  },
  {
    name: "prefix, locator and suffix",
    markdown:
      "[[Doe 2020#cite:prefix=see%20also&label=chapter&locator=3&suffix=for%20context]]",
    plain: "(see also Doe 2020, chap. 3, for context)",
  },
  {
    name: "suppress-author",
    markdown: "[[Smith 2021#cite:mode=suppress-author&locator=7]]",
    plain: "(2021, 7)",
  },
  {
    name: "author-in-text",
    markdown: "[[Doe 2020#cite:mode=author-in-text&locator=33]]",
    plain: "Doe (2020, 33)",
  },
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
    name: "empty fragment",
    markdown: "[[Doe 2020#cite:]]",
    error: "the Citation Fragment is empty",
  },
  {
    name: "parameter without =",
    markdown: "[[Doe 2020#cite:locator]]",
    error: 'is missing its "="',
  },
  {
    name: "empty value",
    markdown: "[[Doe 2020#cite:locator=]]",
    error: '"locator" has an empty value',
  },
  {
    name: "unknown parameter",
    markdown: "[[Doe 2020#cite:page=33]]",
    error: '"page" is not a Citation Fragment parameter',
  },
  {
    name: "duplicate parameter",
    markdown: "[[Doe 2020#cite:locator=1&locator=2]]",
    error: '"locator" appears more than once',
  },
  {
    name: "malformed percent encoding",
    markdown: "[[Doe 2020#cite:locator=%zz]]",
    error: "malformed percent encoding",
  },
  {
    name: "unsupported mode",
    markdown: "[[Doe 2020#cite:mode=narrative]]",
    error: '"mode" does not support "narrative"',
  },
  {
    name: "unsupported label",
    markdown: "[[Doe 2020#cite:label=slide&locator=3]]",
    error: '"label" does not support "slide"',
  },
  {
    name: "label without locator",
    markdown: "[[Doe 2020#cite:label=chapter]]",
    error: '"label" needs a "locator"',
  },
  {
    name: "prefix with author-in-text",
    markdown: "[[Doe 2020#cite:mode=author-in-text&prefix=see]]",
    error: '"prefix" does not combine with mode=author-in-text',
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

function check(name: string, actual: string, ...expected: string[]): void {
  for (const wanted of expected) {
    if (actual.includes(wanted)) continue;
    failures.push(
      `${name}\n  expected: ${wanted}\n  actual:   ${actual.trim()}`,
    );
  }
}

function checkAbsent(name: string, actual: string, unwanted: string[]): void {
  for (const text of unwanted) {
    if (!actual.includes(text)) continue;
    failures.push(
      `${name}\n  unexpected: ${text}\n  actual:     ${actual.trim()}`,
    );
  }
}

async function main(): Promise<void> {
  const version = pandoc(["--version"], { cwd: packageRoot });
  if (version.status !== 0) {
    throw new Error(
      `Could not run "${pandocBin}". Install Pandoc 3.1.1 or newer, or set PANDOC_BIN.`,
    );
  }
  console.log(version.stdout.split("\n")[0]);

  // Realpath, so the paths this script asserts on match the ones Pandoc resolves.
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "zotlit-lua-filter-")),
  );
  try {
    await writeFile(
      join(workspace, "references.json"),
      JSON.stringify(REFERENCES),
    );
    await writeFile(
      join(workspace, "zotlit-resolve-map.json"),
      JSON.stringify(RESOLVE_MAP),
    );
    await writeFile(
      join(workspace, "zotlit.yaml"),
      await readFilterFile("zotlit.yaml"),
    );
    await writeFile(
      join(workspace, "zotlit-cite.lua"),
      buildFilterVariant(await readFilterFile("zotlit-cite.lua"), "sandbox"),
    );

    for (const testCase of CASES) await runCase(workspace, testCase);
    await checkMapErrors(workspace);
    await checkCliVariant(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} failure(s):\n\n${failures.join("\n\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${CASES.length + 2} checks passed`);
}

function readFilterFile(name: string): Promise<string> {
  return readFile(join(filterDir, name), "utf8");
}

/** The defaults file locates the filter beside it, so the run needs no filter flag. */
function convert(workspace: string): Run {
  return pandoc(
    [
      "input.md",
      "--defaults",
      join(workspace, "zotlit.yaml"),
      "--bibliography",
      "references.json",
      "--to",
      "plain",
    ],
    { cwd: workspace },
  );
}

async function runCase(workspace: string, testCase: Case): Promise<void> {
  await writeFile(join(workspace, "input.md"), `${testCase.markdown}\n`);

  if (testCase.native) {
    // Native AST assertions skip citeproc, which would consume the Cite nodes.
    const run = pandoc(
      [
        "input.md",
        "--from",
        "markdown+wikilinks_title_after_pipe",
        "--lua-filter",
        join(workspace, "zotlit-cite.lua"),
        "--to",
        "native",
      ],
      { cwd: workspace },
    );
    if (run.status !== 0) {
      failures.push(`${testCase.name}\n  pandoc failed: ${run.stderr.trim()}`);
      return;
    }
    check(
      testCase.name,
      run.stdout.replaceAll(/\s+/g, " "),
      ...testCase.native,
    );
    return;
  }

  const run = convert(workspace);
  if (testCase.error) {
    if (run.status === 0) {
      failures.push(
        `${testCase.name}\n  expected a non-zero exit, got output: ${run.stdout.trim()}`,
      );
      return;
    }
    check(testCase.name, run.stderr, testCase.error);
    return;
  }
  if (run.status !== 0) {
    failures.push(`${testCase.name}\n  pandoc failed: ${run.stderr.trim()}`);
    return;
  }
  const output = run.stdout.replaceAll(/\s+/g, " ");
  if (testCase.plain) check(testCase.name, output, testCase.plain);
  if (testCase.absent) checkAbsent(testCase.name, output, testCase.absent);
}

/** An error payload in the resolve map stops the run before any conversion. */
async function checkMapErrors(workspace: string): Promise<void> {
  const name = "resolve map errors abort the run";
  await writeFile(join(workspace, "input.md"), "[[Doe 2020]]\n");
  await writeFile(
    join(workspace, "zotlit-resolve-map.json"),
    JSON.stringify({
      errors: [
        {
          code: "item-not-found",
          linkpath: "Doe 2020",
          message: 'No live Item matches Indexed Key "ABC12345".',
        },
      ],
    }),
  );
  const run = convert(workspace);
  await writeFile(
    join(workspace, "zotlit-resolve-map.json"),
    JSON.stringify(RESOLVE_MAP),
  );

  if (run.status === 0) {
    failures.push(
      `${name}\n  expected a non-zero exit, got output: ${run.stdout.trim()}`,
    );
    return;
  }
  check(name, run.stderr, "[item-not-found]");
}

/**
 * The CLI variant against a stub `obsidian` on PATH, which records how it was
 * invoked so the vault-targeting contract stays checked.
 */
async function checkCliVariant(workspace: string): Promise<void> {
  const name = "cli variant calls zotlit:resolve";
  const notes = join(workspace, "notes");
  const bin = join(workspace, "bin");
  const callLog = join(workspace, "obsidian-call.txt");
  const response = join(workspace, "obsidian-response.json");
  await mkdir(notes, { recursive: true });
  await mkdir(bin, { recursive: true });

  await writeFile(response, JSON.stringify(RESOLVE_MAP));
  await writeFile(
    join(bin, "obsidian"),
    [
      "#!/bin/sh",
      `printf '%s|%s\\n' "$PWD" "$*" > "${callLog}"`,
      `cat "${response}"`,
      "",
    ].join("\n"),
  );
  await chmod(join(bin, "obsidian"), 0o755);

  await writeFile(join(notes, "input.md"), "[[Doe 2020#cite:locator=33]]\n");
  await writeFile(
    join(notes, "zotlit-cite.lua"),
    buildFilterVariant(await readFilterFile("zotlit-cite.lua"), "cli"),
  );
  await writeFile(
    join(notes, "zotlit.yaml"),
    await readFilterFile("zotlit.yaml"),
  );

  // Run from the workspace with a relative input, so the filter has to resolve the
  // absolute path and switch into the input's directory itself.
  const run = pandoc(
    [
      "notes/input.md",
      "--defaults",
      join(notes, "zotlit.yaml"),
      "--bibliography",
      "references.json",
      "--to",
      "plain",
    ],
    { cwd: workspace, env: { PATH: `${bin}:${process.env.PATH ?? ""}` } },
  );
  if (run.status !== 0) {
    failures.push(`${name}\n  pandoc failed: ${run.stderr.trim()}`);
    return;
  }
  check(name, run.stdout.replaceAll(/\s+/g, " "), "(Doe 2020, 33)");

  const call = await readFile(callLog, "utf8");
  check(name, call, `zotlit:resolve file=${join(notes, "input.md")}`);
  check(name, call, `${notes}|`);
}

await main();
