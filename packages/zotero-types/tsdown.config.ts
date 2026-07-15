import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/fields.ts",
    csl: "./src/csl.ts",
  },
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: true,
  unbundle: true,
  target: "esnext",
});
