import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, {
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
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
  ...uniqueIdPaths,
];

const commonImports = {
  patterns: [parentImportPattern],
  paths: [...obsidianImportPaths, ...itemQuerySchemaPaths],
};

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    new URL("../../packages/config/oxlint-plugin-design.ts", import.meta.url)
      .pathname,
    "./scripts/oxlint-plugin-popout-windows.ts",
    "./scripts/oxlint-plugin-menu-sections.ts",
    "./scripts/oxlint-plugin-obsidian-css.ts",
    "./scripts/oxlint-plugin-private-api.ts",
  ],
  rules: {
    "no-console": "error",
    "zotlit-obsidian/no-cross-window-instanceof": "error",
    "zotlit-menu/no-literal-section": "error",
    // Repeats the base pattern: a rule set here replaces the base entry.
    "no-restricted-imports": [
      "error",
      {
        ...commonImports,
        paths: [
          {
            name: "@/lib/effect",
            importNames: ["ManagedRuntime", "Scheduler"],
            allowTypeImports: true,
            message:
              "Start Effects through Effect in @/lib/effect; its entry points supply the browser scheduler.",
          },
          {
            name: "effect",
            allowTypeImports: true,
            message:
              "Use @/lib/effect: Obsidian's renderer and workers default to Chromium MessageChannel scheduling. Node setImmediate can starve browser tasks.",
          },
          {
            name: "effect/Effect",
            allowTypeImports: true,
            message: "Use Effect from @/lib/effect for Chromium scheduling.",
          },
          {
            name: "effect/ManagedRuntime",
            allowTypeImports: true,
            message:
              "Use the Effect entry points in @/lib/effect for Chromium scheduling.",
          },
          {
            name: "effect/Scheduler",
            allowTypeImports: true,
            message:
              "Obsidian scheduling is owned by @/lib/effect-runtime and @/lib/browser-scheduler.",
          },
          ...commonImports.paths,
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["src/views/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    ...testBaselineOverrides("apps/obsidian"),
    {
      // UI code runs in the window it stands in, a pop-out included.
      files: ["src/views/**", "src/components/**", "src/**/*.tsx"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      // Guarded private API reaches its surface through obsidian-ex.d.ts.
      files: ["src/lib/obsidian-private/**"],
      rules: { "zotlit-private/no-unknown-cast": "error" },
    },
    {
      // A test's fake App stands in for the whole surface.
      files: ["src/lib/obsidian-private/*.test.ts"],
      rules: { "zotlit-private/no-unknown-cast": "off" },
    },
    {
      // React draws its controls from JSX; imperative DOM builds on Obsidian's.
      files: ["src/**/*.tsx"],
      rules: {
        "zotlit-css/no-obsidian-class": "error",
        "zotlit-css/no-setting-in-react": "error",
      },
    },
    {
      // The wrappers that hand Obsidian's control classes to everything else.
      files: ["src/components/obsidian/**"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
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
        "src/lib/effect.ts",
        "src/lib/effect-runtime.ts",
        "src/lib/browser-scheduler.ts",
      ],
      rules: { "no-restricted-imports": ["error", commonImports] },
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
      // A reading view of a note: the app's own classes draw its Properties
      // block, so the sheet reads as the note does in the editor.
      files: ["src/views/note-preview/markdown.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/views/annot-view/AnnotView.tsx",
        "src/views/annot-view/FilterBar.tsx",
        "src/views/annot-view/tag-editor.tsx",
        "src/views/query-view/sort-control.tsx",
        "src/views/query-view/table-layout.tsx",
        "src/views/template-workbench/theme.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/views/cited-by/CitedBy.tsx",
        "src/views/query-view/query-file-document.ts",
        "src/views/query-view/view.tsx",
        "src/views/welcome/companion-refresh.ts",
        "src/views/welcome/view.tsx",
      ],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: [
        "src/services/citation-popover/content.test.ts",
        "src/services/citekey-navigation/citation.test.ts",
        "src/services/pandoc/inline-content.test.ts",
        "src/setting-tab/create-profile-modal.test.ts",
        "src/setting-tab/profile-destination-modal.test.ts",
        "src/views/cited-by/CitedBy.test.ts",
        "src/views/references/References.test.ts",
        "src/views/references/view.test.ts",
        "src/views/template-workbench/host.test.ts",
        "src/views/welcome/Welcome.test.ts",
      ],
      rules: { "zotlit-tests/no-class-assertion": "off" },
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
