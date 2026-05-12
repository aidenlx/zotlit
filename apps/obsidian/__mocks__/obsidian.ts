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

let platformIsWin: boolean | undefined;

export const Platform = {
  get isWin(): boolean {
    if (platformIsWin === undefined) {
      throw new Error(
        "Platform.isWin not configured — call setMockPlatform({ isWin }) in test setup",
      );
    }
    return platformIsWin;
  },
};

/**
 * Configure the mocked `Platform` for the current test. Mirrors the real
 * `obsidian` module, where `Platform` is effectively read-only — tests must
 * never assign to `Platform.isWin` directly.
 */
export function setMockPlatform(overrides: { isWin?: boolean }): void {
  if (overrides.isWin !== undefined) platformIsWin = overrides.isWin;
}

export function resetMockPlatform(): void {
  platformIsWin = undefined;
}

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
