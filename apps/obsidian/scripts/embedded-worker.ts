// Build-time bundle of a Web Worker entry, embedded in the plugin bundle as a string module.

import { regex } from "arkregex";
import { build } from "vite";
import type { InlineConfig, Plugin } from "vite";

export interface EmbeddedWorkerOptions {
  /** The module id the plugin code imports, e.g. `virtual:zotero-reads-worker`. */
  id: string;
  /** Absolute path of the worker entry. */
  entry: string;
  /**
   * Build settings the worker shares with the plugin bundle (`define`,
   * `resolve`, `minify`, ...). Node builtins listed in `external` stay
   * `require()` calls that resolve through the worker's Node integration.
   */
  config: Pick<InlineConfig, "define" | "resolve" | "mode"> & {
    external: string[];
    minify: boolean;
    sourcemap: boolean | "inline";
    target: string;
  };
}

/** A worker must never load the Obsidian API: it does not exist off the main thread. */
const FORBIDDEN_REQUIRE = regex(
  `\\brequire\\(\\s*["'](?<module>obsidian|electron)["']\\s*\\)`,
);

/**
 * Serves `id` as `export default "<worker source>"`: the entry bundled on its
 * own as one CommonJS file, so the plugin ships no extra file and spawns the
 * worker from a blob URL. Every module in the worker bundle is watched, so a
 * watch build rebuilds the worker when any of them changes.
 *
 * A worker runs its source as a classic script, where a top-level declaration
 * becomes a property of the worker's global object. The bundle runs inside a
 * function, so its declarations stay local: Effect's own `setImmediate`, for
 * one, would replace the global it calls.
 */
export function embeddedWorker(options: EmbeddedWorkerOptions): Plugin {
  const resolvedId = `\0${options.id}`;
  const { external, minify, sourcemap, target, ...shared } = options.config;
  return {
    name: "embedded-worker",
    resolveId(id) {
      return id === options.id ? resolvedId : null;
    },
    async load(id) {
      if (id !== resolvedId) return null;
      const result = await build({
        ...shared,
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          reportCompressedSize: false,
          emptyOutDir: false,
          copyPublicDir: false,
          minify,
          sourcemap,
          target,
          lib: {
            entry: options.entry,
            formats: ["cjs"],
            fileName: () => "worker.js",
          },
          rolldownOptions: {
            external: ["obsidian", "electron", ...external],
            output: { codeSplitting: false },
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((item) => item.type === "chunk");
      if (!chunk)
        this.error(`The worker build of ${options.entry} emitted no chunk`);
      const forbidden = FORBIDDEN_REQUIRE.exec(chunk.code);
      if (forbidden) {
        this.error(
          `The worker bundle of ${options.entry} requires "${forbidden.groups.module}", which a worker cannot load`,
        );
      }
      for (const moduleId of chunk.moduleIds) {
        if (!moduleId.startsWith("\0")) this.addWatchFile(moduleId);
      }
      // The opening shares the first line, so the source map lines still match.
      const scoped = `(() => {${chunk.code}\n})();\n`;
      return `export default ${JSON.stringify(scoped)};`;
    },
  };
}
