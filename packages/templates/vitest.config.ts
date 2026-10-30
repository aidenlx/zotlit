import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  resolve: {
    alias: {
      "@defaults": resolve(import.meta.dirname, "defaults"),
    },
  },
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
