import "core-js/proposals/explicit-resource-management";
import type { ZotLitZotero as ZotLitZoteroCtor } from "./main";
import { logToBrowserConsole } from "./lib/zotero-log";

/**
 * Shape of the `params` object Zotero's plugin loader passes to every
 * bootstrap lifecycle hook. Built in `_callMethod` and forwarded as the
 * first argument of `func.call(scope, params, reason)` — see
 * https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L248-L258.
 * For `onMainWindowLoad` / `onMainWindowUnload`, Zotero additionally merges
 * `{ window }` into the same object via the `extraParams` argument — see
 * https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L106
 * — represented by {@link WindowBootstrapData}.
 *
 * `reason` is one of Zotero's `REASONS` integers (1=APP_STARTUP,
 * 2=APP_SHUTDOWN, 3=ADDON_ENABLE, ..., 9=MAIN_WINDOW_LOAD,
 * 10=MAIN_WINDOW_UNLOAD) — see
 * https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L53-L64.
 */
interface BootstrapData {
  id: string;
  version: string;
  rootURI: string;
}

interface WindowBootstrapData extends BootstrapData {
  window: Window;
}

/**
 * Scope object populated by `Services.scriptloader.loadSubScript(..., scope)`.
 * The IIFE wrapper around `main.js` declares `var ZotLitZotero = ...` at its
 * top level (via the Vite/rolldown `output.footer`), and `loadSubScript`
 * attaches every top-level `var`/`function` declaration of the loaded script
 * onto the explicit `targetObj` we pass as the second argument.
 *
 * Why an explicit scope object (rather than `this` or no second argument):
 *   - `this` inside `startup({...}, reason)` would be the bootstrap sandbox
 *     global, but TypeScript/ESM output runs in strict mode where the
 *     identity of `this` at the top level depends on how the bundler emits
 *     entry code (Vite IIFE wraps user code in `"use strict"`, where `this`
 *     becomes `undefined` at the module top level after bundling). Passing
 *     `this` from a strict-mode function expression is fine here, but it
 *     couples our loader to a JS-language semantic that future bundler
 *     changes can quietly break.
 *   - Omitting the second argument loads the script into the *caller's*
 *     global — i.e. our bootstrap sandbox — polluting it with whatever
 *     bindings the bundle introduces (e.g. a synthetic IIFE-wrapper name).
 *   - An explicit, dedicated scope object isolates the load: only the names
 *     we read (`ZotLitZotero`) leave this function. No accidental sandbox
 *     pollution, and the binding contract is visible in this file.
 */
interface MainScope {
  ZotLitZotero?: typeof ZotLitZoteroCtor;
}

let plugin: InstanceType<typeof ZotLitZoteroCtor> | undefined;

function logBootstrapError(message: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `[${error.name}] ${error.message}\n${error.stack ?? ""}`
      : String(error);
  const printMessage = `${message}: ${detail}`;
  logToBrowserConsole(printMessage, "error", "bootstrap.js");
  Zotero.debug(printMessage, 1);
}

function loadMain(rootURI: string): typeof ZotLitZoteroCtor {
  const scope: MainScope = Object.create(null) as MainScope;
  Services.scriptloader.loadSubScript(`${rootURI}main.js`, scope);
  const ctor = scope.ZotLitZotero;
  if (!ctor) {
    throw new Error(
      "main.js did not expose ZotLitZotero on the load scope — check vite output.footer",
    );
  }
  return ctor;
}

export function install(_data: BootstrapData, _reason: number): void {}

export function uninstall(_data: BootstrapData, _reason: number): void {}

export function startup(
  { id, version, rootURI }: BootstrapData,
  reason: number,
): void {
  try {
    const ZotLitZotero = loadMain(rootURI);
    plugin = new ZotLitZotero({ id, version, rootURI });
    plugin.startup(reason).catch((error: unknown) => {
      logBootstrapError("ZotLit startup error", error);
    });
  } catch (error: unknown) {
    logBootstrapError("ZotLit startup error", error);
  }
}

export function shutdown(_data: BootstrapData, reason: number): void {
  const current = plugin;
  plugin = undefined;
  current?.shutdown(reason).catch((error: unknown) => {
    logBootstrapError("ZotLit shutdown error", error);
  });
}

export function onMainWindowLoad({ window }: WindowBootstrapData): void {
  plugin?.onMainWindowLoad(window);
}

export function onMainWindowUnload({ window }: WindowBootstrapData): void {
  plugin?.onMainWindowUnload(window);
}
