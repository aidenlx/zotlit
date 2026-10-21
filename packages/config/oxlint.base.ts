import { join } from "node:path";
import { defineConfig } from "oxlint";

import testBaseline from "./oxlint-tests-baseline.json" with { type: "json" };

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

/** Exact baseline paths relative to the package's nested lint config. */
export function testBaselineOverrides(directory: string) {
  const prefix = `${directory}/`;
  const files = testBaseline
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length));
  // Entries may be deleted, never added.
  return files.length === 0
    ? []
    : [
        {
          files,
          rules: {
            "zotlit-tests/no-source-text": "off" as const,
            "zotlit-tests/no-internal-mock": "off" as const,
          },
        },
      ];
}

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
    "vitest",
  ],
  jsPlugins: [join(import.meta.dirname, "oxlint-plugin-build.ts")],
  rules: {
    "zotlit-build/no-undeclared-env": "error",
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/prefer-readonly": "error",

    "no-unused-vars": "error",
    "no-param-reassign": "error",
    "default-param-last": "error",
    "max-params": ["error", { max: 3 }],
    // A whole-output snapshot pins structure, not behavior: index the
    // artifact and assert the keys a test owns (policies/tautological-tests.md).
    // oxlint reads inline snapshots only; packages/scripts/scripts/snapshot-size.ts
    // checks .snap files.
    "vitest/no-large-snapshots": ["error", { inlineMaxSize: 50 }],
    // An assertion on one path only lets a test pass without checking it.
    "vitest/no-conditional-expect": "error",
    // An unawaited async assertion never fails its test. valid-expect would
    // also flag the deferred `const rejection = expect(p).rejects…` that
    // policies/test-timing.md requires; no-floating-promises passes it.
    "typescript/no-floating-promises": "error",
    "vitest/valid-expect": "off",
    // Default rules of the plugin with an untriaged backlog; enable each one
    // when its findings are fixed.
    "vitest/require-to-throw-message": "off",
    "vitest/require-mock-type-parameters": "off",
    "vitest/expect-expect": "off",
    "vitest/no-standalone-expect": "off",
    "vitest/valid-describe-callback": "off",
    "vitest/valid-title": "off",
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
      // Nested package configs share the test policy enabled by the root.
      files: ["**/*.test.{ts,tsx,mts,mjs,js}"],
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: {
        "zotlit-tests/no-source-text": "error",
        "zotlit-tests/no-internal-mock": "error",
      },
    },
    {
      // A test asserts what an element does, not the zt: classes that draw it
      // (policies/ui-testing.md).
      files: ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.ts"],
      // Absolute: a config that extends this one cannot resolve a relative path.
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: { "zotlit-tests/no-class-assertion": "error" },
    },
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
