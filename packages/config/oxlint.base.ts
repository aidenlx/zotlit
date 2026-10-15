import { defineConfig } from "oxlint";

export const parentImportPattern = {
  group: ["../**"],
  message: "Use @/ alias instead of parent-directory relative imports.",
};

export const itemQuerySchemaPaths = [
  {
    name: "@zotlit/item-query/schema",
    allowTypeImports: true,
    message:
      "The Item Query Schema is build-only. Import runtime values from @zotlit/item-query.",
  },
  {
    name: "@zotlit/item-query/query.schema.json",
    allowTypeImports: true,
    message:
      "The generated Item Query Schema is build-only and must stay out of runtime bundles.",
  },
];

/**
 * `useId` counts within one Preact root, and Obsidian mounts each view, modal
 * and pane as a root of its own, so two of them in one window share its ids.
 */
export const uniqueIdPaths = ["react", "preact/compat", "preact/hooks"].map(
  (name) => ({
    name,
    importNames: ["useId"],
    message:
      "Use useUniqueId from @zotlit/ui: useId counts within one Preact root, so two views in one window share its ids.",
  }),
);

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: [
    "react",
    "react-perf",
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "promise",
  ],
  rules: {
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/prefer-readonly": "error",

    "no-unused-vars": "error",
    "no-param-reassign": "error",
    "default-param-last": "error",
    "max-params": ["error", { max: 3 }],
    "no-else-return": "error",
    "prefer-template": "warn",
    "no-useless-concat": "error",

    "no-restricted-globals": [
      "error",
      {
        name: "Date",
        message:
          "Use Temporal (policies/temporal-dates.md); apps/zotero and the named apps/docs date helpers are the exceptions.",
      },
    ],
    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-string-replace-all": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern],
        paths: [...itemQuerySchemaPaths, ...uniqueIdPaths],
      },
    ],
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "separate-type-imports", disallowTypeAnnotations: false },
    ],
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  },
  overrides: [
    {
      // Tests and build scripts can inspect the generated schema.
      files: [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/*.{config,setup}.{ts,js,mjs,cjs}",
        "**/scripts/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern],
            paths: uniqueIdPaths,
          },
        ],
      },
    },
    {
      // The module that defines the hook the ban points to.
      files: ["**/use-unique-id.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern],
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
  ],
});
