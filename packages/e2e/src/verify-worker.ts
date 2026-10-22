// Required desktop gate for changes that can block the database worker.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import {
  acquireDesktopSlotOrExit,
  automatedLease,
  DEFAULT_LEASE_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { E2E_RESULTS_ENV, newE2eResultsDir } from "./results-dir.ts";
import { isObsidianReachable } from "./vault-script.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
if (!(await isObsidianReachable(root))) {
  throw new Error(
    "Worker responsiveness requires a running desktop Obsidian with its CLI enabled. Open a host vault, then run pnpm e2e:worker again.",
  );
}
// The nested `pnpm e2e` reuses this hold through the environment, inside its
// Lease.
using _slot = await acquireDesktopSlotOrExit({
  cwd: root,
  command: "pnpm e2e:worker",
  leaseMs: automatedLease(DEFAULT_LEASE_MS.e2eWorker),
});
// The nested run writes its results to the folder chosen here.
const results = newE2eResultsDir();
const report = join(results, "results.json");
await $({
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, [E2E_RESULTS_ENV]: results },
})`pnpm e2e citation-index`;
const result = JSON.parse(await readFile(report, "utf8")) as {
  numPassedTests: number;
  numPendingTests: number;
  success: boolean;
};
if (
  !result.success ||
  result.numPassedTests < 3 ||
  result.numPendingTests !== 0
) {
  throw new Error(
    "Worker responsiveness requires all three desktop regression cases to execute and pass.",
  );
}
