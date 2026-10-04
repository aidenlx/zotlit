import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    ...testDefaults,
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "highest", include: ["src/**/*.test.ts"] },
      },
      {
        // The query scenario and the parity suite again on the lowest supported
        // Zotero layout.
        extends: true,
        test: {
          name: "lowest",
          include: ["src/query-items.test.ts", "src/parity.test.ts"],
          env: { ZOTLIT_SCENARIO_LAYOUT: "lowest" },
        },
      },
    ],
  },
});
