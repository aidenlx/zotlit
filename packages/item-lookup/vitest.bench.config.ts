import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    ...testDefaults,
    include: ["src/**/*.bench.ts"],
    environment: "node",
  },
});
