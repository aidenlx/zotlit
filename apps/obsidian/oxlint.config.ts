import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "no-console": "error",
    // Repeats the base pattern: a rule set here replaces the base entry.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../**"],
            message:
              "Use @/ alias instead of parent-directory relative imports.",
          },
        ],
        paths: [
          {
            name: "obsidian",
            importNames: ["HoverPopover"],
            allowTypeImports: true,
            message:
              "Extend PopoutAwareHoverPopover from @/lib/popout-aware-hover-popover; it cancels Obsidian's popover timers on the window that armed them (see policies/hover-popover.md).",
          },
        ],
      },
    ],
  },
  overrides: [
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
