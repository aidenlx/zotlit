import { defineConfig } from "oxlint";

import baseConfig, {
  itemQuerySchemaPaths,
  parentImportPattern,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    // This package's runtime entry may re-export schema types, but not values.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          parentImportPattern,
          {
            group: [
              "./schema",
              "./schema.*",
              "@/schema",
              "@/schema.*",
              "./describe-annotation-query",
              "./describe-annotation-query.*",
              "@/describe-annotation-query",
              "@/describe-annotation-query.*",
              "./describe-item-query",
              "./describe-item-query.*",
              "@/describe-item-query",
              "@/describe-item-query.*",
            ],
            allowTypeImports: true,
            message:
              "The static Item Query Schema and vocabulary are build-only.",
          },
        ],
        paths: itemQuerySchemaPaths,
      },
    ],
  },
  overrides: [
    {
      // Static vocabulary generation and its direct tests own these values.
      files: [
        "src/schema.ts",
        "src/describe-item-query.ts",
        "src/describe-annotation-query.ts",
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
        "scripts/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern],
          },
        ],
      },
    },
  ],
});
