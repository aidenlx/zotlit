import { build, defineConfig } from "vite";

import {
  resolveEnv,
  zoteroBuildPlugin,
  zoteroSandboxConfig,
} from "./scripts/vite-zotero-plugin.js";

const here = import.meta.dirname;

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

export default defineConfig(async ({ mode }) => {
  const env = resolveEnv(mode);

  // Build bootstrap.js first as a separate IIFE bundle. We can't do this in
  // the same Vite/Rolldown build as main.js because IIFE format is
  // single-entry by design: each top-level `var X = (function(){…})()`
  // wrapper produces exactly one file. Running the inner `build()` from
  // here (during the async config phase) is the cleanest way to keep both
  // bundles produced by a single `vite build` invocation — the outer build
  // continues with main.js after this resolves.
  await build(
    zoteroSandboxConfig(here, env, {
      entry: "src/bootstrap.ts",
      iifeName: BOOTSTRAP_IIFE_NAME,
      fileName: "bootstrap.js",
      exports: BOOTSTRAP_HOOKS,
      // First of the pair — clean staging so stale assets from a prior run
      // don't leak into this XPI.
      emptyOutDir: true,
    }),
  );

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
      zoteroBuildPlugin({
        root: here,
        addonStaging: env.addonStaging,
        xpiOutDir: env.xpiOutDir,
        isProd: env.isProd,
      }),
    ],
  };
});
