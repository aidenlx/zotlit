// Required desktop gate for changes that can block the database worker.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { isObsidianReachable } from "./vault-script.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
if (!(await isObsidianReachable(root))) {
  throw new Error(
    "Worker responsiveness requires a running desktop Obsidian with its CLI enabled. Open a host vault, then run pnpm e2e:worker again.",
  );
}
const report = join(root, ".scratch", "e2e-results", "results.json");
await rm(report, { force: true });
await $({ cwd: root, stdio: "inherit" })`pnpm e2e citation-index`;
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
