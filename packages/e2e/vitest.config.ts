import { join } from "node:path";
import { defineConfig } from "vitest/config";

import { e2eResultsDir } from "./src/results-dir.ts";

export default defineConfig({
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
          globalSetup: ["./src/desktop-lock-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "paired",
          include: ["src/paired-run.e2e.ts"],
          // The lock comes first: Paired Zotero starts only for its holder.
          globalSetup: ["./src/desktop-lock-setup.ts", "./src/paired-setup.ts"],
        },
      },
    ],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    // Every file drives the one desktop Obsidian and opens its own Fixture and
    // vault, so two files at once would take focus and windows from each other.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
