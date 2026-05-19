import { defineConfig, type ConfigEnv } from "vite";

import { fluentPlugin } from "./scripts/vite-fluent-plugin.js";
import {
  resolveEnv,
  zoteroBuildPlugin,
  zoteroSandboxConfig,
} from "./scripts/vite-zotero-plugin.js";

const here = import.meta.dirname;

const FLUENT_PREFIX = "zotlit";
const FLUENT_FILE = "zotlit.ftl";

// Names that Zotero's plugin loader expects as top-level bindings on the
// bootstrap scope. Each is rebound in the bootstrap bundle's footer.
const BOOTSTRAP_HOOKS = [
  "install",
  "uninstall",
  "startup",
  "shutdown",
  "onMainWindowLoad",
  "onMainWindowUnload",
] as const;
const BOOTSTRAP_IIFE_NAME = "__zotlitBootstrap";

// Names that bootstrap.js plucks off the `loadSubScript` scope object. Each
// is rebound in main.js's footer so it becomes a top-level `var`.
const MAIN_EXPORTS = ["ZotLitZotero"] as const;
const MAIN_IIFE_NAME = "__zotlitMain";

// bootstrap.js and main.js can't share one Vite/Rolldown build: IIFE format
// is single-entry by design (each top-level `var X = (function(){…})()`
// wrapper produces exactly one file). The plugin runs the inner bootstrap
// build inside `buildStart`, adds its module ids to the watch graph, and
// owns staging-dir cleanup — so a single outer watcher picks up changes to
// either source tree.
const bootstrapBundle = {
  entry: "src/bootstrap.ts",
  iifeName: BOOTSTRAP_IIFE_NAME,
  fileName: "bootstrap.js",
  exports: BOOTSTRAP_HOOKS,
} as const;

export function createZoteroViteConfig({ mode }: ConfigEnv) {
  const env = resolveEnv(mode);

  return {
    ...zoteroSandboxConfig(here, env, {
      entry: "src/main.ts",
      iifeName: MAIN_IIFE_NAME,
      fileName: "main.js",
      exports: MAIN_EXPORTS,
      // `using` keyword supported in firefox 141, but firefox 140 target
      // incorrectly flips `using` as supported; target es2023 explicitly here
      target: "es2023",
    }),
    plugins: [
      // Runs before zoteroBuildPlugin: validates + writes locale FTLs and
      // codegens `src/types/fluent.d.ts` before the zip step picks them up.
      fluentPlugin({
        root: here,
        env,
        prefix: FLUENT_PREFIX,
        localeDir: "locale",
        ftlFileName: FLUENT_FILE,
        addonDir: "addon",
        typesOutput: "src/types/fluent.d.ts",
        primaryLocale: "en-US",
      }),
      zoteroBuildPlugin({
        root: here,
        env,
        bootstrapBundle,
      }),
    ],
  };
}

export default defineConfig(createZoteroViteConfig);
