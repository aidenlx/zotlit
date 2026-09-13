import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  target: "esnext",
});
