/**
 * String constants shared between the Vite/Rolldown build (filenames it
 * emits, FTL filename the build pipeline derives into `addon/locale/<locale>/`)
 * and runtime code that has to reference the same names (e.g.
 * `loadSubScript("…/main.js")`, `new Localization(["zotlit.ftl"])`).
 *
 * Keep this module dependency-free: it is loaded both in the Zotero plugin
 * sandbox (no Node globals) and in Node-side Vite plugins.
 */

/** Derived from the inlang project; emitted at `addon/locale/<locale>/<this>`. */
export const FLUENT_FILE_NAME = "zotlit.ftl";

/** Plugin sandbox loader entry — `bootstrap.ts` does `loadSubScript("…/" + MAIN_BUNDLE_NAME)`. */
export const MAIN_BUNDLE_NAME = "main.js";

/** Zotero bootstrap entry declared in `manifest.json` — emitted alongside `MAIN_BUNDLE_NAME`. */
export const BOOTSTRAP_BUNDLE_NAME = "bootstrap.js";

/** Dev-runner handshake written only after companion startup completes. */
export const DEV_READY_FILE_NAME = ".zotlit-dev-ready";
