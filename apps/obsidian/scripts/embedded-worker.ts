import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";
import type { Plugin } from "vite";

/** Embed an independent Node bundle in the plugin's single distributable main.js. */
export function embeddedWorker(service: "item-query" | "item-lookup"): Plugin {
  const id = `virtual:${service}-worker`;
  return {
    name: `${service}-worker`,
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
            entry: resolve(root, `src/services/${service}/worker.ts`),
            formats: ["cjs"],
            fileName: () => `${service}.cjs`,
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
        throw new Error(`${service} worker build returned no bundle`);
      const chunk = built.output.find((entry) => entry.type === "chunk");
      if (!chunk) throw new Error(`${service} worker build returned no code`);
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path);
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}
