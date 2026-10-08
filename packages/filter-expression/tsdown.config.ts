import { defineLibrary } from "@zotlit/config/tsdown";

export default defineLibrary({
  entry: [
    {
      index: "./src/index.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: true,
});
