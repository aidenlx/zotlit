import { regex } from "arkregex";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { embeddedWorker } from "./embedded-worker.ts";

const ID = "virtual:scheduler-worker";

/** A name a top-level `var` or function declaration can take. */
const DECLARED_NAME = regex("^[\\p{ID_Start}$_][\\p{ID_Continue}$]*$", "u");

/** The worker source the plugin bundle embeds for `entry`. */
async function workerSource(minify: boolean): Promise<string> {
  const plugin = embeddedWorker({
    id: ID,
    entry: resolve(import.meta.dirname, "__fixtures__/scheduler-worker.ts"),
    config: {
      mode: "production",
      define: {},
      external: [],
      minify,
      sourcemap: false,
      target: "es2025",
    },
  });
  const load = plugin.load as (this: unknown, id: string) => Promise<string>;
  const module = await load.call(
    {
      addWatchFile: () => {},
      error: (message: string) => {
        throw new Error(message);
      },
    },
    `\0${ID}`,
  );
  return JSON.parse(
    module.replace(/^export default /, "").replace(/;$/, ""),
  ) as string;
}

describe("embeddedWorker", () => {
  // A worker runs its source as a classic script: a top-level declaration
  // there becomes a property of the worker's global object. Effect declares
  // its own `setImmediate`, which then replaces the host's and calls itself
  // until the stack overflows.
  it.each([false, true])(
    "keeps the bundle's declarations off the worker global (minify: %s)",
    async (minify) => {
      const source = await workerSource(minify);
      const hostSetImmediate = vi.fn(setImmediate);
      const done = Promise.withResolvers<void>();
      const scope = createContext({
        setImmediate: hostSetImmediate,
        clearImmediate,
        setTimeout,
        clearTimeout,
        reportDone: done.resolve,
      });
      const globalsBefore = Object.keys(scope);

      runInContext(source, scope);
      await done.promise;

      expect(scope.setImmediate).toBe(hostSetImmediate);
      expect(hostSetImmediate).toHaveBeenCalled();
      // Effect keeps its own registry on the global under `~effect/` keys.
      const added = Object.keys(scope).filter(
        (key) => !globalsBefore.includes(key),
      );
      expect(added.filter((key) => DECLARED_NAME.test(key))).toEqual([]);
    },
  );
});
