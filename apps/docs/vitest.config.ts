import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

// Unit seam only — the app's own Vite config carries the Cloudflare and
// TanStack Start plugins, which neither a pure-function test nor the
// collection index has any use for.
export default defineConfig({
  test: testDefaults,
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [fumadocsMdx({ index: false })],
});
