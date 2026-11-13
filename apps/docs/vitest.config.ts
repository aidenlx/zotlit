import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

import { scanChinesePages } from "./src/lib/content-scan.js";
import { scanLearnMedia } from "./src/lib/learn-media.js";

// Unit seam only — the app's own Vite config carries the Cloudflare and
// TanStack Start plugins, which neither a pure-function test nor the
// collection index has any use for.
export default defineConfig({
  define: {
    __DOCS_CHINESE_PAGES__: JSON.stringify(
      scanChinesePages(import.meta.dirname),
    ),
    __LEARN_MEDIA__: JSON.stringify(scanLearnMedia(import.meta.dirname)),
    // Tests play the clips from their site paths, as the dev server does.
    __MEDIA_URLS__: "{}",
  },
  test: testDefaults,
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [fumadocsMdx({ index: false })],
});
