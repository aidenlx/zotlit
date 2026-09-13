import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  test: {
    ...testDefaults,
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
