import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

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
  },
  overrides: [
    {
      // Codegen scripts read `src/` directly; the `@/` alias resolves for the
      // bundler, not for `node scripts/*.ts`.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": "off",
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
