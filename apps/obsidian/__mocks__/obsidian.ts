/**
 * Runtime stand-in for the `obsidian` module, used by Vitest via
 * `vitest.config.ts` `resolve.alias`. The real `obsidian` package is
 * types-only (`packages/obsidian-api`), so without this alias any test
 * that imports values from `"obsidian"` fails to resolve.
 *
 * Only the surface area the plugin actually touches in tests is exposed
 * here — extend as needed alongside the services that consume it.
 */

import type { Debouncer } from "obsidian";

/**
 * Deterministic test stand-in for Obsidian's `debounce`. Unlike the real
 * implementation it does **not** use timers: the callback fires only when
 * `.run()` is invoked explicitly. This matches how `SettingsService.flush()`
 * drives writes and keeps tests free of fake-timer setup.
 */
export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  _timeout?: number,
  _resetTimer?: boolean,
): Debouncer<T, V> {
  let pending: T | undefined;
  const debouncer = function debouncer(...args: T) {
    pending = args;
    return debouncer;
  } as unknown as Debouncer<T, V> & {
    cancel(): Debouncer<T, V>;
    run(): V | void;
  };
  debouncer.cancel = () => {
    pending = undefined;
    return debouncer;
  };
  debouncer.run = () => {
    if (pending === undefined) return;
    const args = pending;
    pending = undefined;
    return cb(...args);
  };
  return debouncer;
}

/**
 * Minimal `Plugin` stand-in covering the `loadData()` / `saveData()` surface
 * used by `SettingsService`. The variadic constructor swallows the real
 * `(app, manifest)` args so tests can `new Plugin()` without fabricating an
 * `App`. Seed disk state by assigning `__data`, or swap the methods with
 * `vi.spyOn(plugin, "loadData" | "saveData")` for failure-path tests.
 */
export class Plugin {
  /** In-memory stand-in for the plugin's `data.json`; `null` ≡ no file. */
  __data: unknown = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(..._args: unknown[]) {}

  loadData(): Promise<unknown> {
    return Promise.resolve(this.__data);
  }

  saveData(data: unknown): Promise<void> {
    this.__data = data;
    return Promise.resolve();
  }
}
