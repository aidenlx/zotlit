import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/hello.ts"],
  dts: true,
  exports: true,
});
