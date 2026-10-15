// Each run writes its evidence to its own folder under `.scratch/e2e-results`,
// so two runs from one worktree keep their results apart.

import { resolve } from "node:path";

/** The run's results folder; a caller sets it to read the results of a run it starts. */
export const E2E_RESULTS_ENV = "ZOTLIT_E2E_RESULTS";

export const E2E_RESULTS_ROOT = resolve(
  import.meta.dirname,
  "../../../.scratch/e2e-results",
);

/** A new folder name per run: start time, then pid. */
export function newE2eResultsDir(): string {
  const time = Temporal.Now.instant()
    .toString()
    .replaceAll(":", "-")
    .slice(0, 19);
  return resolve(E2E_RESULTS_ROOT, `${time}-${process.pid}`);
}

/** This run's results folder. The first call in the Vitest process chooses it. */
export function e2eResultsDir(): string {
  return (process.env[E2E_RESULTS_ENV] ||= newE2eResultsDir());
}
