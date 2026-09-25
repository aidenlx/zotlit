import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [{ index: "./src/index.ts" }],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  // A host's dev server resolves the `development` condition and reads the
  // source; a production build, Node, and the type checker take `dist`.
  exports: {
    customExports(exports) {
      exports["."] = {
        development: "./src/index.ts",
        default: "./dist/index.mjs",
      };
      return exports;
    },
  },
  target: "esnext",
});
