import { defineLibrary } from "@zotlit/config/tsdown";

export default defineLibrary({
  entry: ["./src/index.ts"],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  target: "esnext",
});
