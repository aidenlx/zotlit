import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      index: "./src/index.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: true,
  unbundle: true,
  target: "esnext",
});
