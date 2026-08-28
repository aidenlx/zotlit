import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsdown";
import type { TsdownPlugin } from "tsdown";

/** Mirrors Vite's `?raw` handling (which vitest uses), so both builds inline the same text content. */
function rawImports(): TsdownPlugin {
  return {
    name: "raw-imports",
    async resolveId(source, importer) {
      if (!source.endsWith("?raw")) return null;
      const resolved = await this.resolve(
        source.slice(0, -"?raw".length),
        importer,
        {
          skipSelf: true,
        },
      );
      return resolved && `${resolved.id}?raw`;
    },
    async load(id) {
      if (!id.endsWith("?raw")) return null;
      const source = await readFile(id.slice(0, -"?raw".length), "utf8");
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/constants.ts",
    "./src/facade.ts",
    "./src/liquid.ts",
    "./src/obsidian.ts",
    "./src/frontmatter.ts",
    "./src/frontmatter-merge.ts",
    "./src/literature-note-pack.ts",
  ],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  alias: {
    "@defaults": resolve(import.meta.dirname, "defaults"),
  },
  plugins: [rawImports()],
  exports: {
    customExports(exports) {
      exports["./defaults/*.eta"] = "./defaults/*.eta";
      exports["./defaults/*.liquid"] = "./defaults/*.liquid";
      return exports;
    },
  },
  unbundle: true,
  target: "esnext",
});
