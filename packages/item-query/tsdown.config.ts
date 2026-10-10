import { defineLibrary } from "@zotlit/config/tsdown";

export default defineLibrary({
  entry: [
    {
      index: "./src/index.ts",
      schema: "./src/schema.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    customExports: {
      "./query.schema.json": "./dist/query.schema.json",
    },
  },
});
