import { defineLibrary } from "@zotlit/config/tsdown";

export default defineLibrary({
  entry: [
    {
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
