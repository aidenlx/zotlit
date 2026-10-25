import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, {
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  plugins: [...(baseConfig.plugins ?? []), "nextjs"],
  rules: {
    // Keep the framework-neutral image check without applying Next.js rules
    // to this TanStack app.
    "nextjs/google-font-display": "off",
    "nextjs/google-font-preconnect": "off",
    "nextjs/inline-script-id": "off",
    "nextjs/next-script-for-ga": "off",
    "nextjs/no-assign-module-variable": "off",
    "nextjs/no-async-client-component": "off",
    "nextjs/no-before-interactive-script-outside-document": "off",
    "nextjs/no-css-tags": "off",
    "nextjs/no-document-import-in-page": "off",
    "nextjs/no-duplicate-head": "off",
    "nextjs/no-head-element": "off",
    "nextjs/no-head-import-in-document": "off",
    "nextjs/no-html-link-for-pages": "off",
    "nextjs/no-img-element": "error",
    "nextjs/no-page-custom-font": "off",
    "nextjs/no-script-component-in-head": "off",
    "nextjs/no-styled-jsx-in-document": "off",
    "nextjs/no-sync-scripts": "off",
    "nextjs/no-title-in-document-head": "off",
    "nextjs/no-typos": "off",
    "nextjs/no-unwanted-polyfillio": "off",
    // The site renders on the server and hydrates one React root, so its ids
    // come from useId, the one id that matches across the two renders. The
    // base rule without its useId ban:
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern, datePattern],
        paths: itemQuerySchemaPaths,
      },
    ],
  },
  jsPlugins: [
    new URL("../../packages/config/oxlint-plugin-design.ts", import.meta.url)
      .pathname,
  ],
  overrides: [
    {
      files: ["src/lib/workbench/*.tsx"],
      excludeFiles: ["**/*.test.tsx"],
      rules: { "zotlit-design/workbench-chrome": "error" },
    },
    ...testBaselineOverrides("apps/docs"),
    {
      // workerd ships no Temporal: the publication-date schema, its date
      // helpers, the Date the feed library takes, and the git date that
      // fumadocs hands in (AGENTS.md → Dates).
      files: [
        "src/lib/shared.ts",
        "src/routes/changelog/rss\\[.\\]xml.ts",
        "src/components/docs-last-updated.tsx",
        "src/lib/sitemap.ts",
      ],
      rules: {
        "effecttsgo/global-date": "off",
        "effecttsgo/global-date-in-effect": "off",
        "no-restricted-globals": "off",
        "typescript/no-restricted-types": "off",
      },
    },
    {
      // Codegen scripts read `src/` directly; the `@/` alias resolves for the
      // bundler, not for `node scripts/*.ts`.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
  ignorePatterns: [
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
    "dist/**",
    ".tanstack/**",
  ],
});
