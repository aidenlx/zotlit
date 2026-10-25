import { recommended } from "@effect/tsgo/oxlint-presets";
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

/**
 * The date rule: Effect code uses Effect's `DateTime` (time read through
 * `Clock`), other code uses TC39 `Temporal`, and no code uses `Date`,
 * `date-fns` or `dayjs`. One date type per side keeps each value's instant,
 * zone and serialized string the same as it crosses between them. A library
 * that takes or hands in a `Date` converts in one adapter module, which an
 * override names with its reason.
 */
const dateFix =
  "Use Temporal outside Effect and DateTime in Effect code (DateTime.now or Clock for the current time). A library that takes or gives a Date converts in its adapter module.";

/** `no-restricted-globals`: every use of the `Date` global. */
export const dateGlobals = {
  globals: [{ name: "Date", message: dateFix }],
  checkGlobalObject: true,
};

/** `typescript/no-restricted-types`: `Date` as a type. */
export const dateTypes = { types: { Date: dateFix } };

/** `no-restricted-imports` pattern for the date libraries. Every restatement of the rule spreads it. */
export const datePattern = {
  group: ["date-fns", "date-fns/**", "dayjs", "dayjs/**"],
  message: dateFix,
};

/**
 * One override per baselined rule, with exact paths relative to the nested
 * lint config in `directory`, or to the repository root when it is omitted.
 */
export function testBaselineOverrides(directory?: string) {
  const prefix = directory ? `${directory}/` : "";
  const filesByRule = new Map<string, string[]>();
  for (const [file, rules] of Object.entries(
    testBaseline as Record<string, string[]>,
  )) {
    if (!file.startsWith(prefix)) continue;
    for (const rule of rules)
      filesByRule.set(rule, [
        ...(filesByRule.get(rule) ?? []),
        file.slice(prefix.length),
      ]);
  }
  // Entries may be deleted, never added.
  return [...filesByRule].map(([rule, files]) => ({
    files,
    rules: { [rule]: "off" as const },
  }));
}

/**
 * `@effect/tsgo` rules that are off by default and that this repository turns
 * on (apps/obsidian/oxlint.config.ts opts in to the console rules). Every
 * other rule keeps the level of the `recommended` preset.
 */
const effectOptInRules = [
  "global-date",
  "global-date-in-effect",
  "global-fetch-in-effect",
  "global-timers-in-effect",
  "process-env-in-effect",
].map((rule) => [`effecttsgo/${rule}`, "error"] as const);

/**
 * `@effect/tsgo` rules that support Effect v3 only (`SupportedEffect: ["v3"]`):
 * they never report on the Effect v4 this repository uses, so they are off.
 */
const effectV3OnlyRules = [
  "generic-effect-services",
  "missing-effect-service-dependency",
  "non-object-effect-service-type",
  "schema-union-of-literals",
  "scope-in-layer-effect",
].map((rule) => [`effecttsgo/${rule}`, "off"] as const);

/**
 * `@effect/tsgo` rules this repository turns off. `any-unknown-in-error-context`:
 * `unknown` is the correct error at a Promise seam and in generic helpers that
 * accept any Effect; the tsgo default is also off.
 */
const effectOffRules = ["any-unknown-in-error-context"].map(
  (rule) => [`effecttsgo/${rule}`, "off"] as const,
);

export default defineConfig({
  extends: [recommended],
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
    "no-restricted-globals": ["error", dateGlobals],
    "typescript/no-restricted-types": ["error", dateTypes],
    ...Object.fromEntries(effectOptInRules),
    ...Object.fromEntries(effectV3OnlyRules),
    ...Object.fromEntries(effectOffRules),
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/prefer-readonly": "error",
    // A union member erased by another is an inference bug, not intent: an
    // `infer` that came out `never` silently drops a type from a signature.
    "typescript/no-redundant-type-constituents": "error",

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

    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-string-replace-all": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern, datePattern],
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
      // A unit test asserts what an element does; its classes and markup
      // belong in the End-to-end Run (policies/testing-strategy.md).
      files: ["**/*.test.{ts,tsx}"],
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: { "zotlit-tests/no-markup-assertion": "error" },
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
            patterns: [parentImportPattern, datePattern],
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
            patterns: [parentImportPattern, datePattern],
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
  ],
});
