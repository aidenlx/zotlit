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
