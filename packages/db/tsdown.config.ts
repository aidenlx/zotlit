import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      index: "./src/index.ts",
      "client/*": "./src/client/*.ts",
      "contract/ir": "./src/contract/ir.ts",
      path: "./src/lib/zt-path.ts",
      "test-utils": "./src/test-utils.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    customExports: {
      "./contract/ir.json": "./src/contract/generated/ir.json",
    },
  },
  unbundle: true,
  target: "esnext",
});
