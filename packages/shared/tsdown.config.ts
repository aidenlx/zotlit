import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

const AUGMENT_FILE = "temporal-polyfill.d.ts";
const TEMPORAL_DTS = "temporal.d.mts";
const REFERENCE_LINE = `/// <reference path="./${AUGMENT_FILE}" />\n`;

export default defineConfig({
  entry: [
    {
      temporal: "./src/temporal.ts",
      "log-formatter": "./src/log-formatter.ts",
      nanoevents: "./src/nanoevents.ts",
    },
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: { tsgo: true, enabled: true },
  exports: true,
  unbundle: true,
  target: "esnext",
  copy: [`./src/${AUGMENT_FILE}`],
  hooks: {
    "build:done": async (ctx) => {
      const outDir = ctx.options.outDir;
      const path = join(outDir, TEMPORAL_DTS);
      const original = await readFile(path, "utf8");
      if (!original.includes(AUGMENT_FILE)) {
        await writeFile(path, REFERENCE_LINE + original);
      }
    },
  },
});
