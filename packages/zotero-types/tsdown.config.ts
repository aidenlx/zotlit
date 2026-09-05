import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/fields.ts",
    csl: "./src/csl.ts",
    "item-types": "./src/item-types.ts",
  },
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    customExports: {
      "./schema.json": "./zotero-schema/schema.json",
      "./fixtures/item-to-csl.json": "./fixtures/item-to-csl.json",
    },
  },
  unbundle: true,
  target: "esnext",
});
