import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

// The pure logic of the measurement script: no Obsidian, so it runs in
// `pnpm test`. The End-to-end Run keeps `vitest.config.ts`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // A bare run passes the Memory Gate, like every other package's tests.
    globalSetup: testDefaults.globalSetup,
    environment: "node",
  },
});
