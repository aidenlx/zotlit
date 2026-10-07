import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";
import type { Plugin } from "vite";

const id = "virtual:item-query-worker";

/** Embed an independent Node bundle in the plugin's single distributable main.js. */
export function itemQueryWorker(): Plugin {
  return {
    name: "item-query-worker",
    resolveId(source) {
      if (source === id) return `\0${id}`;
    },
    async load(source) {
      if (source !== `\0${id}`) return;
      const root = resolve(import.meta.dirname, "..");
      const result = await build({
        configFile: false,
        root,
        logLevel: "warn",
        resolve: {
          alias: { "@": resolve(root, "src") },
          conditions: ["module", "node"],
        },
        build: {
          write: false,
          target: "node24",
          minify: true,
          lib: {
            entry: resolve(root, "src/services/item-query/worker.ts"),
            formats: ["cjs"],
            fileName: () => "item-query.cjs",
          },
          rolldownOptions: {
            external: [
              ...builtinModules,
              ...builtinModules.map((name) => `node:${name}`),
            ],
            output: { codeSplitting: false },
          },
        },
      });
      const built = Array.isArray(result) ? result[0]! : result;
      if (!("output" in built))
        throw new Error("Item Query worker build returned no bundle");
      const chunk = built.output.find((entry) => entry.type === "chunk");
      if (!chunk) throw new Error("Item Query worker build returned no code");
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path);
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}
