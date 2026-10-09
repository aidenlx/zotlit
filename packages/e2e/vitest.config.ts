import { defineConfig } from "vitest/config";

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
        },
      },
      {
        extends: true,
        test: {
          name: "paired",
          include: ["src/paired-run.e2e.ts"],
          globalSetup: ["./src/paired-setup.ts"],
        },
      },
    ],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: "../../.scratch/e2e-results/results.json" },
    environment: "node",
    // Every file drives the one desktop Obsidian and opens its own Fixture and
    // vault, so two files at once would take focus and windows from each other.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
