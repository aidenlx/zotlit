import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

import { pageTransform } from "./page-transform.ts";

// The pure logic of the measurement script: no Obsidian, so it runs in
// `pnpm test`. The End-to-end Run keeps `vitest.config.ts`.
export default defineConfig({
  oxc: pageTransform,
  test: {
    include: ["src/**/*.test.ts"],
    // A bare run passes the Memory Gate, like every other package's tests.
    globalSetup: testDefaults.globalSetup,
    environment: "node",
  },
});
