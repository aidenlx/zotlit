import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      index: "./src/index.ts",
      types: "./src/types.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: true,
  unbundle: true,
  target: "esnext",
});
