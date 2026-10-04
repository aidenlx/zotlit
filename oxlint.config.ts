import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: [
    "**/dist/**",
    // PROTOTYPE branch only: throwaway #595 benchmark is exempt from production lint
    "packages/item-query/prototype/**",
    "**/dist-dev/**",
    "**/build/**",
    "**/.turbo/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/coverage/**",
    "**/*.min.js",
    "pnpm-lock.yaml",
    ".agents/**",
    ".claude/**",
    ".scratch/**",
    "tests/zt-vault/**",
    "packages/obsidian-api/**",
    "packages/pdfjs-dist/**",
  ],
  overrides: [
    {
      files: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
      plugins: ["vitest"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
    {
      // Root release script reaches across apps to reuse their manifest helpers.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
});
