import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      index: "./src/index.ts",
      "client/*": "./src/client/*.ts",
      path: "./src/lib/zt-path.ts",
      "test-utils": "./src/test-utils.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: true,
  unbundle: true,
  target: "esnext",
});
