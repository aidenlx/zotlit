import { defineLibrary } from "@zotlit/config/tsdown";

export default defineLibrary({
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
