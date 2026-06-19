import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/constants.ts",
    "./src/obsidian.ts",
    "./src/frontmatter.ts",
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: {
    customExports(exports) {
      exports["./defaults/*"] = "./defaults/*.eta";
      return exports;
    },
  },
  unbundle: true,
  target: "esnext",
});
