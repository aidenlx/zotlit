import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/compiler.ts",
    "./src/vite.ts",
    "./src/cli.ts",
    "./src/cli-main.ts",
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  unbundle: true,
  target: "esnext",
});
