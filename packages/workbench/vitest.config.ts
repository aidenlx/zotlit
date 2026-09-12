import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

/** The shared Workbench UI suite, run once per React runtime below. */
const UI_TESTS = ["src/ui/**/*.test.tsx"];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    ...testDefaults,
    // `include` lives on the projects: Vite merges a root `include` into each
    // project's own, which would widen every project back to everything.
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "core", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "ui-react", include: UI_TESTS, environment: "happy-dom" },
      },
      {
        // Obsidian runs the tree on Preact, so the same suite runs a second
        // time with React aliased the way the plugin's build aliases it.
        extends: true,
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
            "@testing-library/react": "@testing-library/preact",
          },
        },
        test: {
          name: "ui-preact",
          include: UI_TESTS,
          environment: "happy-dom",
          server: {
            deps: {
              // Run through Vite so its `react` import lands on the alias.
              inline: ["zustand"],
            },
          },
        },
      },
    ],
  },
});
