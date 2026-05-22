import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      index: "./src/index.ts",
      "client/*": "./src/client/*.ts",
      schema: "./drizzle/schema.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: true,
});
