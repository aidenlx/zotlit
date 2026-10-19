// The benchmarks of the plugin: `src/**/*.bench.ts`, which build large
// databases and take minutes, so `pnpm test` (vitest.config.ts) leaves them
// out. Run with `pnpm --filter @zotlit/obsidian bench`.
//
// It repeats the `resolve`, `define` and `plugins` of vitest.config.ts rather
// than merging that file: its `projects` would carry their `include` here.
import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

const packageRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(packageRoot, "__mocks__/obsidian.ts"),
    },
    tsconfigPaths: true,
  },
  define: {
    __DEV__: JSON.stringify(true),
    __WEB_WORKBENCH_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
    __PANDOC_ENGINE__: JSON.stringify({
      version: "0.0.0",
      url: "https://example.invalid/pandoc.wasm.zip",
      sha256: "0".repeat(64),
    }),
    __CHINESE_SEGMENTER__: JSON.stringify({
      version: "0.0.0",
      url: "https://example.invalid/jieba_rs_wasm_bg.wasm",
      sha256: "0".repeat(64),
    }),
  },
  plugins: [preact()],
  test: {
    ...testDefaults,
    include: ["src/**/*.bench.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.js"],
    // One grid runs for many minutes; the bench sets its own per-test timeout.
    testTimeout: 0,
    fileParallelism: false,
  },
});
