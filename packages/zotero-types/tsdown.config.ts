import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    fields: "./src/fields.ts",
  },
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: true,
});
