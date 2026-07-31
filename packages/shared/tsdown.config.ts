import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    {
      temporal: "./src/temporal.ts",
      "indexed-key": "./src/indexed-key.ts",
      "log-formatter": "./src/log-formatter.ts",
      nanoevents: "./src/nanoevents.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: true,
  unbundle: true,
  target: "esnext",
});
