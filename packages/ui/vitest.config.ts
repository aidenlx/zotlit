import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

/** The UI suite, run once per React runtime below. */
const UI_TESTS = ["src/**/*.test.tsx"];

export default defineConfig({
  test: {
    ...testDefaults,
    // `include` lives on the projects: Vite merges a root `include` into each
    // project's own, which would widen every project back to everything.
    environment: "happy-dom",
    projects: [
      {
        extends: true,
        test: { name: "react", include: UI_TESTS },
      },
      {
        // Obsidian runs the parts on Preact, so the same suite runs a second
        // time with React aliased the way the plugin's build aliases it.
        extends: true,
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
            "@testing-library/react": "@testing-library/preact",
          },
        },
        test: { name: "preact", include: UI_TESTS },
      },
    ],
  },
});
