import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DefaultReporter } from "vitest/node";
import type { TestCase, TestModuleState } from "vitest/node";

/** Keep console evidence on disk while terminal output follows suite progress. */
export default class E2eReporter extends DefaultReporter {
  readonly #directory = resolve(
    import.meta.dirname,
    "../../../.scratch/e2e-results",
  );
  readonly #log = resolve(this.#directory, "console.log");

  override onInit(...args: Parameters<DefaultReporter["onInit"]>): void {
    super.onInit(...args);
    mkdirSync(this.#directory, { recursive: true });
    for (const file of ["results.json", "paired-startup.log"]) {
      rmSync(resolve(this.#directory, file), { force: true });
    }
    writeFileSync(this.#log, "");
    this.log(`E2E evidence: ${this.#directory}`);
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
