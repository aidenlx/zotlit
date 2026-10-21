#!/usr/bin/env node
import type { CollectionConfig } from "#test-gates";
import { regex } from "arkregex";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  matchesCollection,
  matchesNodeTest,
  projectCollection,
} from "#test-gates";
import { checkTestPolicy } from "#test-policy";

const root = resolve(import.meta.dirname, "../../..");
const gitFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 },
)
  .split("\0")
  .filter((file) => file && existsSync(join(root, file)));
const testFile = regex("\\.(?:test\\.[cm]?[jt]sx?|e2e\\.ts)$");
const tests = [
  ...new Set(gitFiles.filter((file) => testFile.test(file))),
].sort();
const collected = new Set<string>();
const packageFiles = gitFiles.filter((file) =>
  regex("^(?:apps|packages)/[^/]+/package\\.json$").test(file),
);
const extensions = ["ts", "mts", "cts", "js", "mjs", "cjs"];

/** Load configuration only; this starts no Vitest server and collects no tests. */
async function collectVitest(cwd: string, args: string[]) {
  const require = createRequire(join(cwd, "package.json"));
  const vitestRequire = createRequire(require.resolve("vitest/package.json"));
  const { loadConfigFromFile, mergeConfig } = await import(
    pathToFileURL(vitestRequire.resolve("vite")).href
  );
  const { configDefaults } = await import(
    pathToFileURL(require.resolve("vitest/config")).href
  );
  const { glob } = await import(
    pathToFileURL(vitestRequire.resolve("tinyglobby")).href
  );
  const configIndex = args.findIndex(
    (arg) => arg === "--config" || arg === "-c",
  );
  const configFile =
    configIndex >= 0
      ? args[configIndex + 1]
      : args.find((arg) => arg.startsWith("--config="))?.slice(9);
  const optionsWithValues = new Set([
    "--config",
    "-c",
    "--reporter",
    "--maxWorkers",
  ]);
  const filters = args.filter(
    (arg, index) =>
      !arg.startsWith("-") && !optionsWithValues.has(args[index - 1] ?? ""),
  );
  const selected =
    configFile ??
    ["vitest", "vite"]
      .flatMap((name) =>
        extensions.map((extension) => `${name}.config.${extension}`),
      )
      .find((file) => existsSync(join(cwd, file)));
  const previous = process.cwd();
  let config: CollectionConfig;
  try {
    process.chdir(cwd);
    config = selected
      ? (
          await loadConfigFromFile(
            { command: "serve", mode: "test" },
            resolve(cwd, selected),
            cwd,
            "silent",
          )
        )?.config
      : {};
    if (!config) throw new Error(`Cannot load Vitest config in ${cwd}`);
  } finally {
    process.chdir(previous);
  }
  const projectRoot = resolve(cwd, config.root ?? ".");
  const { projects, ...test } = config.test ?? {};
  if (!projects) {
    collect(config, cwd);
    return;
  }
  for (const project of projects) {
    if (typeof project === "string") {
      const paths: string[] = await glob(project, {
        cwd: projectRoot,
        absolute: true,
        expandDirectories: false,
        onlyFiles: false,
      });
      for (const path of paths) {
        const filename = existsSync(join(path, "package.json"))
          ? extensions
              .map((extension) => join(path, `vitest.config.${extension}`))
              .find(existsSync)
          : path;
        if (!filename) throw new Error(`Cannot resolve Vitest project ${path}`);
        await collectVitest(dirname(filename), [
          "--config",
          filename,
          ...filters,
        ]);
      }
      continue;
    }
    if (typeof project.extends === "string") {
      // Vite resolves imported configuration; a project-level extends file is
      // a separate configuration entry, with its inline fields merged on top.
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "test" },
        resolve(projectRoot, project.extends),
        projectRoot,
        "silent",
      );
      if (!loaded)
        throw new Error(`Cannot load project extends ${project.extends}`);
      const merged = mergeConfig(loaded.config, project) as CollectionConfig;
      collect(merged, projectRoot);
    } else
      collect(
        project.extends
          ? (mergeConfig(
              { ...config, root: projectRoot, test },
              project,
            ) as CollectionConfig)
          : project,
        projectRoot,
      );
  }
  function collect(project: CollectionConfig, cwd: string) {
    const collection = {
      ...projectCollection(project, cwd, configDefaults),
      filters,
    };
    for (const file of tests)
      if (matchesCollection(join(root, file), collection)) collected.add(file);
  }
}

// Package tests, the desktop e2e task and root eval-runtime are the test gates.
for (const file of ["package.json", ...packageFiles]) {
  const manifest = JSON.parse(readFileSync(join(root, file), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const commands =
    file === "package.json"
      ? [manifest.scripts?.["test:eval-runtime"]]
      : [
          manifest.scripts?.test,
          ...(file === "packages/e2e/package.json"
            ? [manifest.scripts?.e2e]
            : []),
        ];
  for (const command of commands) {
    if (!command) continue;
    for (const segment of command.split("&&")) {
      const words = segment
        .trim()
        .split(regex("\\s+"))
        .map((word) => word.replace(regex("^['\"]|['\"]$", "g"), ""));
      const cwd = join(root, dirname(file));
      if (words[0] === "vitest" && words[1] === "run")
        await collectVitest(cwd, words.slice(2));
      else if (words[0] === "node" && words.includes("--test")) {
        const patterns = words
          .slice(words.indexOf("--test") + 1)
          .filter((word) => !word.startsWith("-"));
        for (const test of tests)
          if (matchesNodeTest(join(root, test), cwd, patterns))
            collected.add(test);
      } else
        throw new Error(
          `Unsupported test gate in ${relative(root, cwd)}: ${segment.trim()}`,
        );
    }
  }
}
const ungated = tests.filter((file) => !collected.has(file));
if (ungated.length) {
  console.error(
    `${ungated.length} test file(s) run in no package test gate (policies/testing-strategy.md):\n${ungated.map((file) => `  ${file}`).join("\n")}`,
  );
  process.exitCode = 1;
} else
  console.log(
    `check-test-gates: ${tests.length} test files, all collected by a gate.`,
  );

const policyErrors = await checkTestPolicy(root, gitFiles);
if (policyErrors.length) {
  console.error(
    `Test policy violations (policies/testing-strategy.md):\n${policyErrors.map((error) => `  ${error}`).join("\n")}`,
  );
  process.exitCode = 1;
}
