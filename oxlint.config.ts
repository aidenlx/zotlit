import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: [
    "**/dist/**",
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
    "tests/fixture-vault-*/**",
    "packages/scripts/lib/fixture/vault-plugins/**",
    "packages/obsidian-api/**",
    "packages/pdfjs-dist/**",
    "video/**",
  ],
  overrides: [
    {
      files: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
      plugins: ["vitest"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
    ...testBaselineOverrides(),
    {
      // The rule's own test cases hold the code it reports.
      files: ["packages/config/oxlint-plugin-tests.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      // Written before the rule; the file moves off this list when its
      // assertions move to behavior.
      files: ["packages/e2e/src/walkthrough.e2e.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      // Root release script reaches across apps to reuse their manifest helpers.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
});
