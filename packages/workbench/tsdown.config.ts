import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      language: "./src/language/index.ts",
      document: "./src/document/index.ts",
      render: "./src/render/index.ts",
      explorer: "./src/explorer/index.ts",
      bridge: "./src/bridge/index.ts",
      snapshot: "./src/snapshot/index.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    customExports(exports) {
      exports["./snapshot"] = {
        types: "./dist/snapshot.d.mts",
        node: "./dist/snapshot.mjs",
      };
      return exports;
    },
  },
  unbundle: true,
  target: "esnext",
});
