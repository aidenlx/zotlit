import json from "@eslint/json";
import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import pkg from "./apps/obsidian/package.json" with { type: "json" };

/**
 * The community directory scanner's ESLint run, for `apps/obsidian/src`.
 *
 * Mirrors the type-aware branch of `buildScannerEslintConfig` in
 * obsidianmd/obsidian-workflows `src/lint.ts` at
 * 8167caed39664214d82c86fdfa32e06d8d55f61d. To resync, compare that function
 * with this file: `SCANNER_IGNORES`, `toWarns` and the scanner rule blocks are
 * copied from it.
 *
 * `pnpm review` runs ESLint with `--quiet`, so it reports the error-level
 * findings that block a release. The scanner's warnings stay advisory.
 * oxlint runs the type-free `obsidianmd/*` rules on every lint, through
 * packages/config/oxlint-plugin-obsidian.ts.
 *
 * The scanner rejects any `eslint-disable` of an `obsidianmd/*` rule. Suppress
 * those with `oxlint-disable-next-line`, which ESLint reads as a plain comment.
 *
 * Run it from the workspace root: the plugin reads `manifest.json` relative to
 * `process.cwd()`.
 *
 * @see docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md
 */

const SCANNER_IGNORES = [
  "node_modules",
  "dist",
  "build",
  "pkg",
  "test-vault",
  ".obsidian",
  "**/.obsidian/**",
  "esbuild.config.mjs",
  "version-bump.mjs",
  "**/*.test.*",
  "**/*.tests.*",
  "**/*.spec.*",
  "**/*.specs.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/mocks/**",
  "**/__mocks__/**",
  "**/*.cjs",
  "**/*.mjs",
  "**/*.cts",
  "**/*.mts",
  "**/vite*",
  "**/scripts/**",
  "**/docs/**",
  "**/i18n/**",
  "**/i18next/**",
  "**/locale/**",
  "**/locales/**",
  "**/translations/**",
  "**/l10n/**",
  ".pnpm-store",
  "**/*.spec.ts",
  "**/testUtils**",
  "automation/**",
  "e2e-tests/**",
];

/** Every severity below `eslint-comments/*` drops to warn, as the scanner does. */
function toWarns(config) {
  if (!config.rules) return config;
  const rules = Object.entries(config.rules).map(([key, value]) => {
    if (key.startsWith("eslint-comments/")) return [key, value];
    if (value === "error" || value === 2) return [key, "warn"];
    if (Array.isArray(value) && (value[0] === "error" || value[0] === 2))
      return [key, ["warn", ...value.slice(1)]];
    return [key, value];
  });
  return { ...config, rules: Object.fromEntries(rules) };
}

export default [
  // The plugin's recommended config globs every TypeScript file. Ignore the
  // tree, then unignore the review targets: each ancestor directory has to be
  // unignored for traversal to descend into it.
  {
    ignores: [
      "**/*",
      "!apps/",
      "!apps/obsidian/",
      "!apps/obsidian/src/",
      "!apps/obsidian/src/**",
      "!manifest.json",
    ],
  },

  {
    files: ["apps/obsidian/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  ...obsidianmd.configs.recommended.map(toWarns),

  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },

  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "import/no-unresolved": "off",

      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",
    },
  },

  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "@typescript-eslint": tseslint.plugin, obsidianmd },
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",

      "eslint-comments/require-description": "error",

      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      // `getManifest()` reads the root manifest.json, which release.ts only
      // refreshes on stable bumps. package.json is the version source
      // release.ts derives the manifest from, so it is accurate on either
      // release line.
      "obsidianmd/no-unsupported-api": [
        "error",
        { minAppVersion: pkg.obsidian.minAppVersion },
      ],
    },
  },

  globalIgnores(SCANNER_IGNORES),

  // The recommended config wires the `json/json` language for package.json
  // only, so manifest.json needs its own block for validate-manifest to see it.
  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: { json, obsidianmd },
    rules: { "obsidianmd/validate-manifest": "error" },
  },
];
