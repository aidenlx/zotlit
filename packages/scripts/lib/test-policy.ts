import { regex } from "arkregex";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { $ } from "zx";

import { affectedBase } from "#affected-base";

const baselineFile = "packages/config/oxlint-tests-baseline.json";
const sourceFile = regex("\\.[cm]?[jt]sx?$");
const configFile = regex(
  "(?:^|/)(?:oxlint\\.config\\.[cm]?[jt]s|\\.oxlintrc\\.json)$",
);
const directive = regex(
  "^\\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?\\b",
);
const rule = regex("\\bzotlit-tests/(?:no-source-text|no-internal-mock)\\b");
const disabledRule = regex(
  "['\"](zotlit-tests/(?:no-source-text|no-internal-mock))['\"]\\s*\\]?\\s*:",
  "g",
);
const disabledSeverity = regex(
  "^\\s*(?:\\[\\s*)?(?:['\"](?:off|allow)['\"]|0\\b)",
);

/** Check the shrinking baseline and the places that can bypass the test rules. */
export async function checkTestPolicy(
  root: string,
  files: string[],
): Promise<string[]> {
  const errors: string[] = [];
  const baseline = JSON.parse(
    readFileSync(join(root, baselineFile), "utf8"),
  ) as string[];
  const base = await affectedBase(root);
  const previous = base
    ? await $({
        cwd: root,
        quiet: true,
        nothrow: true,
      })`git show ${base}:${baselineFile}`
    : undefined;
  if (previous?.exitCode === 0) {
    const allowed = new Set<string>(JSON.parse(previous.stdout));
    for (const file of baseline)
      if (!allowed.has(file))
        errors.push(`${baselineFile}: added baseline entry ${file}`);
  } else {
    // A shallow clone has no base; the branch that introduces the baseline
    // has nothing to compare against.
    console.log(
      `check-test-gates: ${base ? "no baseline at the merge base" : "no merge base"}; skipping baseline growth check.`,
    );
  }
  for (const file of baseline)
    if (!existsSync(join(root, file)))
      errors.push(`${baselineFile}: missing file ${file}`);

  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }).split("\0"),
  );
  // Use the parser already installed for the config package's lint rules.
  const require = createRequire(import.meta.url);
  const configRequire = createRequire(require.resolve("@zotlit/config/oxlint"));
  const { parseSync } = (await import(
    pathToFileURL(configRequire.resolve("oxc-parser")).href
  )) as {
    parseSync: (
      file: string,
      source: string,
    ) => { comments: { value: string; start: number; end: number }[] };
  };
  for (const file of files) {
    const config = file !== "oxlint.config.ts" && configFile.test(file);
    if (!config && !(tracked.has(file) && sourceFile.test(file))) continue;
    const source = readFileSync(join(root, file), "utf8");
    const comments = parseSync(file, source).comments;
    if (tracked.has(file)) {
      for (const comment of comments) {
        // The optional -- suffix is a reason, not part of the rule list.
        const rules = comment.value.split("--")[0] ?? "";
        if (directive.test(rules) && rule.test(rules)) {
          const line = source.slice(0, comment.start).split("\n").length;
          errors.push(`${file}:${line}: test-rule disable directive`);
        }
      }
    }
    if (config) {
      // Keep whitespace in place so comments cannot join unrelated tokens.
      let code = source;
      for (const comment of comments.toReversed())
        code =
          code.slice(0, comment.start) +
          " ".repeat(comment.end - comment.start) +
          code.slice(comment.end);
      for (const match of code.matchAll(disabledRule))
        if (disabledSeverity.test(code.slice(match.index + match[0].length)))
          errors.push(`${file}: ${match[1]} must stay enabled`);
    }
  }
  return errors;
}
