import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/constants.ts",
    "./src/facade.ts",
    "./src/liquid.ts",
    "./src/obsidian.ts",
    "./src/frontmatter.ts",
    "./src/frontmatter-merge.ts",
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    customExports(exports) {
      exports["./defaults/*.eta"] = "./defaults/*.eta";
      exports["./defaults/*.liquid"] = "./defaults/*.liquid";
      return exports;
    },
  },
  unbundle: true,
  target: "esnext",
});
