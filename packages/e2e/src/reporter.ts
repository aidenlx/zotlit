import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { DefaultReporter } from "vitest/node";
import type { TestCase, TestModuleState } from "vitest/node";

import { E2E_RESULTS_ROOT, e2eResultsDir } from "./results-dir.ts";

/** Run folders kept under the results root, this run's included. */
const KEPT_RUNS = 10;

/** Keep console evidence on disk while terminal output follows suite progress. */
export default class E2eReporter extends DefaultReporter {
  readonly #directory = e2eResultsDir();
  readonly #log = resolve(this.#directory, "console.log");

  override onInit(...args: Parameters<DefaultReporter["onInit"]>): void {
    super.onInit(...args);
    mkdirSync(this.#directory, { recursive: true });
    writeFileSync(this.#log, "");
    this.#pointLatest();
    this.#pruneRuns();
    this.log(`E2E evidence: ${this.#directory}`);
  }

  /** `latest` names the run that started last. */
  #pointLatest(): void {
    const draft = resolve(E2E_RESULTS_ROOT, `latest.${process.pid}`);
    rmSync(draft, { force: true });
    symlinkSync(basename(this.#directory), draft, "junction");
    renameSync(draft, resolve(E2E_RESULTS_ROOT, "latest"));
  }

  /** Remove the oldest run folders. A run folder name starts with its time. */
  #pruneRuns(): void {
    // Results of the runs from before the run folders.
    for (const file of ["results.json", "console.log", "paired-startup.log"]) {
      rmSync(resolve(E2E_RESULTS_ROOT, file), { force: true });
    }
    const runs = readdirSync(E2E_RESULTS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
      .map((entry) => entry.name)
      .toSorted();
    for (const run of runs.slice(0, -KEPT_RUNS)) {
      if (run === basename(this.#directory)) continue;
      rmSync(resolve(E2E_RESULTS_ROOT, run), { recursive: true, force: true });
    }
  }

  override onUserConsoleLog(
    ...[log]: Parameters<DefaultReporter["onUserConsoleLog"]>
  ): void {
    appendFileSync(this.#log, `[${log.type}] ${log.content}\n`);
  }

  onTestModuleStart(
    module: Parameters<DefaultReporter["onTestModuleEnd"]>[0],
  ): void {
    this.log(`Running ${this.relative(module.moduleId)}`);
  }

  protected override printTestCase(
    state: TestModuleState,
    test: TestCase,
  ): void {
    if (test.result().state === "failed") super.printTestCase(state, test);
  }
}
