// oxfmt picks the *nearest* config per subtree — no merge with parent configs.
// Nested configs that declare their own ignorePatterns MUST spread this list
// first; omitting the spread silently drops all entries defined here.
import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  endOfLine: "lf",
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  arrowParens: "always",
  bracketSpacing: true,
  bracketSameLine: false,
  ignorePatterns: [
    "**/dist/**",
    "**/build/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/__fixtures__/**",
    "**/__snapshots__/**",
    "pnpm-lock.yaml",
    // Agent skills are synced from upstream sources and checked against the
    // hashes in skills-lock.json.
    ".agents/**",
  ],
  sortImports: {
    newlinesBetween: true,
    customGroups: [
      {
        groupName: "zotlit-packages",
        elementNamePattern: ["@zotlit/**"],
      },
      {
        groupName: "path-aliases",
        elementNamePattern: ["@/**"],
      },
    ],
    groups: [
      ["type-import", "value-builtin", "value-external"],
      "zotlit-packages",
      "path-aliases",
      [
        "type-parent",
        "type-sibling",
        "type-index",
        "value-parent",
        "value-sibling",
        "value-index",
      ],
      "unknown",
    ],
  },
});
