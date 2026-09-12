import { defineConfig } from "tsdown";

import { CONTRACT_ROOTS } from "./src/contract/roots.ts";

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
    // The committed contract artifacts ship as JSON, so they are published
    // from source rather than bundled. One schema per root, read from the
    // registry the generator emits from, so a new root cannot land unpublished.
    customExports: {
      "./contract/ir.json": "./src/contract/generated/ir.json",
      "./contract/ir.runtime.json": "./src/contract/generated/ir.runtime.json",
      ...Object.fromEntries(
        CONTRACT_ROOTS.map((root) => [
          `./contract/${root}.schema.json`,
          `./src/contract/generated/${root}.schema.json`,
        ]),
      ),
    },
  },
  unbundle: true,
  target: "esnext",
});
