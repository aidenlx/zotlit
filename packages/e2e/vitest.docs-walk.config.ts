import { join } from "node:path";
import { defineConfig } from "vitest/config";

import { pageTransform } from "./page-transform.ts";
import { e2eResultsDir } from "./src/results-dir.ts";

// The docs walks: one file per docs lesson, run as its reader would. They stay
// out of `pnpm e2e` and the release gate; see AGENTS.md, "Docs walks".
export default defineConfig({
  oxc: pageTransform,
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/docs-walks/**/*.walk.ts"],
    globalSetup: ["./src/docs-walks/docs-walk-setup.ts"],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    // Each walk opens its own Paired Run, so walks go one at a time.
    fileParallelism: false,
    // A walk's steps build on each other: the first failure ends the walk.
    bail: 1,
    testTimeout: 60000,
    hookTimeout: 300000,
  },
});
