import { join } from "node:path";
import { defineConfig } from "vitest/config";

import { pageTransform } from "./page-transform.ts";
import { e2eResultsDir } from "./src/results-dir.ts";

export default defineConfig({
  oxc: pageTransform,
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "desktop",
          include: ["src/**/*.e2e.ts"],
          exclude: ["src/paired-run.e2e.ts"],
          globalSetup: ["./src/desktop-slot-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "paired",
          include: ["src/paired-run.e2e.ts"],
          // The slot comes first: Paired Zotero starts only for its holder.
          globalSetup: ["./src/desktop-slot-setup.ts", "./src/paired-setup.ts"],
        },
      },
    ],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    // A run holds one Desktop Slot and drives its files one at a time: they
    // share the run's vault and its window focus emulation. Runs in other
    // worktrees take their own slots.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
