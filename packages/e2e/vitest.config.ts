import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.e2e.ts"],
    environment: "node",
    // Every file drives the one desktop Obsidian and opens its own Fixture and
    // vault, so two files at once would take focus and windows from each other.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
