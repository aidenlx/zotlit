import json from "@eslint/json";
import obsidianmd from "eslint-plugin-obsidianmd";

import pkg from "./apps/obsidian/package.json" with { type: "json" };

/**
 * Every rule the recommended config activates that is not `obsidianmd/*`,
 * mapped to "off".
 *
 * `obsidianmd.configs.recommended` bundles a full general-purpose suite —
 * `js.configs.recommended`, typescript-eslint's `recommendedTypeChecked`,
 * `import`, `eslint-comments`, `depend`, `no-unsanitized` and
 * `@microsoft/sdl`, 176 rules in total. All of that is oxlint's job in this
 * repo: oxlint runs with `typeAware`/`typeCheck` on, implements 59 of 61
 * type-aware typescript-eslint rules, and carries deliberate tuning
 * (`typescript/no-explicit-any` is off) that a second linter would
 * re-litigate. This scan keeps only the 39 `obsidianmd/*` rules, which are the
 * Obsidian-specific checks oxlint has no equivalent for.
 *
 * Derived from the config rather than hand-listed, so it stays complete as the
 * plugin's baseline moves.
 */
const nonObsidianRules = Object.fromEntries(
  obsidianmd.configs.recommended
    .flatMap((config) => Object.keys(config.rules ?? {}))
    .filter((rule) => !rule.startsWith("obsidianmd/"))
    .map((rule) => [rule, "off"]),
);

/**
 * Obsidian plugin guideline review — a second linter that runs only at release.
 *
 * oxlint + oxfmt remain the routine toolchain (see AGENTS.md); this config
 * exists solely so `eslint-plugin-obsidianmd` can check `apps/obsidian` against
 * the official Obsidian developer guidelines before a release is cut. Run it
 * with `pnpm review` from the workspace root — the plugin reads `manifest.json`
 * relative to `process.cwd()`, so the root is the only correct cwd.
 *
 * @see docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md
 */
export default [
  // The plugin's recommended config globs `**/*.{ts,tsx}`, which would reach
  // every workspace. Ignore the tree, then unignore only the review targets —
  // each ancestor directory has to be unignored for traversal to descend into
  // it. This is what lets the scripts be a bare `eslint`.
  {
    ignores: [
      "**/*",
      "!apps/",
      "!apps/obsidian/",
      "!apps/obsidian/src/",
      "!apps/obsidian/src/**",
      "!manifest.json",
      "apps/obsidian/src/lib/i18n/generated/**",
      // tsconfig.app.json excludes these, so type-aware parsing cannot see them.
      "**/*.test.{ts,tsx}",
      // Test fixtures build DOM under Vitest alone, never inside a running
      // Obsidian window, so the guideline checks that assume Obsidian's
      // globals (createDiv(), .win, …) don't apply to them.
      "**/__fixtures__/**",
    ],
  },

  ...obsidianmd.configs.recommended,

  { rules: nonObsidianRules },

  {
    files: ["apps/obsidian/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./apps/obsidian/tsconfig.app.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `getManifest()` reads the root manifest.json, which release.ts only
      // refreshes on stable bumps — so during a beta it names the previous
      // stable. package.json is the version source release.ts derives the
      // manifest from, making it the accurate answer on either release line.
      "obsidianmd/no-unsupported-api": [
        "error",
        { minAppVersion: pkg.obsidian.minAppVersion },
      ],
    },
  },

  // The recommended config wires the `json/json` language for package.json
  // only, so manifest.json needs its own block for validate-manifest to see it.
  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: { json, obsidianmd },
    rules: { "obsidianmd/validate-manifest": "error" },
  },
];
