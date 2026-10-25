// Applies Obsidian's Effect entry points at build time: plugin code imports
// `effect` and `@effect/vitest`, and this plugin resolves them to the wrappers
// in src/lib that supply the browser scheduler and the runtime services.

import { resolve } from "node:path";
import type { Plugin } from "vite";

/** The renderer entry carries the LogTape bridge; the worker entry does not. */
export type EffectEntry = "renderer" | "worker";

const libDir = resolve(import.meta.dirname, "../src/lib");
const lib = (name: string) => resolve(libDir, name);

const ENTRIES: Record<EffectEntry, Record<string, string>> = {
  renderer: {
    effect: lib("effect.ts"),
    "effect/Effect": lib("effect-runtime.ts"),
  },
  worker: {
    effect: lib("effect-worker.ts"),
    "effect/Effect": lib("effect-worker-runtime.ts"),
  },
};

const VITEST = { "@effect/vitest": lib("effect-vitest.ts") };

/**
 * The plugin code this plugin applies to: the sources, and the build scripts
 * that Vite bundles with them.
 */
const SCOPES = ["../src/", "../scripts/"].map(
  (dir) => `${resolve(import.meta.dirname, dir)}/`,
);

/** The wrappers and the modules they import: these reach the real package. */
const NATIVE = new Set(
  [
    "browser-scheduler.ts",
    "effect.ts",
    "effect-layer.ts",
    "effect-log.ts",
    "effect-runtime.ts",
    "effect-runtime-factory.ts",
    "effect-services.ts",
    "effect-vitest.ts",
    "effect-worker.ts",
    "effect-worker-runtime.ts",
  ].map(lib),
);

/**
 * Resolves `effect` and `effect/Effect`, imported from plugin code, to the
 * `entry` wrappers; with `vitest`, also `@effect/vitest` to
 * src/lib/effect-vitest.ts. The wrappers and everything outside the plugin
 * code (`node_modules` among it) get the real package.
 */
export function effectEntry(
  entry: EffectEntry,
  options: { vitest?: boolean } = {},
): Plugin {
  const targets: Record<string, string> = {
    ...ENTRIES[entry],
    ...(options.vitest ? VITEST : {}),
  };
  return {
    name: "zotlit-effect-entry",
    enforce: "pre",
    resolveId(id, importer) {
      if (!Object.hasOwn(targets, id) || importer === undefined) return null;
      const path = importer.split("?", 1)[0]!;
      if (!SCOPES.some((scope) => path.startsWith(scope))) return null;
      if (NATIVE.has(path)) return null;
      return targets[id];
    },
  };
}

/**
 * Fails the build when an entry chunk does not run through the `entry`
 * wrapper, or a worker chunk takes in the renderer's LogTape bridge: the
 * redirect is wiring, and a config without `effectEntry` still builds.
 */
export function effectEntryCheck(entry: EffectEntry): Plugin {
  const runtime = ENTRIES[entry]["effect/Effect"]!;
  const foreign =
    entry === "worker"
      ? [lib("effect-runtime.ts"), lib("effect-log.ts")]
      : [lib("effect-worker-runtime.ts")];
  return {
    name: "zotlit-effect-entry-check",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        if (!chunk.moduleIds.includes(runtime))
          this.error(
            `${chunk.fileName} does not run Effect through ${runtime}; is effectEntry("${entry}") in its config?`,
          );
        const wrong = chunk.moduleIds.find((id) => foreign.includes(id));
        if (wrong)
          this.error(`The ${entry} chunk ${chunk.fileName} includes ${wrong}`);
      }
    },
  };
}
