import { defineConfig } from "oxlint";

import baseConfig, {
  itemQuerySchemaPaths,
  parentImportPattern,
} from "@zotlit/config/oxlint";

const obsidianImportPaths = [
  {
    name: "semver",
    allowTypeImports: true,
    message:
      "Import from semver/functions/<name> to keep unused semver code out of the plugin bundle.",
  },
  {
    name: "obsidian",
    importNames: ["HoverPopover"],
    allowTypeImports: true,
    message:
      "Extend PopoutAwareHoverPopover from @/lib/popout-aware-hover-popover; it cancels Obsidian's popover timers on the window that armed them (see policies/hover-popover.md).",
  },
];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    "./scripts/oxlint-plugin-popout-windows.ts",
    "./scripts/oxlint-plugin-menu-sections.ts",
  ],
  rules: {
    "no-console": "error",
    "zotlit-obsidian/no-cross-window-instanceof": "error",
    "zotlit-menu/no-literal-section": "error",
    // Repeats the base pattern: a rule set here replaces the base entry.
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern],
        paths: [...obsidianImportPaths, ...itemQuerySchemaPaths],
      },
    ],
  },
  overrides: [
    {
      // Tests can inspect the schema; the plugin's other import rules remain.
      files: [
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern],
            paths: obsidianImportPaths,
          },
        ],
      },
    },
    {
      files: [
        "vite.config.ts",
        "scripts/check-lua-filter.ts",
        "src/zt-main.ts",
        "src/services/build.ts",
        "src/services/service-base.ts",
        "src/services/settings/service.ts",
        "src/services/log/**",
      ],
      rules: {
        "no-console": "off",
      },
    },
    {
      // The one module that wraps Obsidian's popover itself.
      files: ["src/lib/popout-aware-hover-popover.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
    {
      // This stand-in implements the runtime helper that the rule requires.
      files: ["vitest.setup.js"],
      rules: {
        "zotlit-obsidian/no-cross-window-instanceof": "off",
      },
    },
    {
      // The rule tests reach the package-local Oxlint modules in scripts/.
      files: ["src/lint/*.test.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
    {
      // Node runs these straight from source, where the `@/` alias the rule
      // points at does not resolve.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
});
