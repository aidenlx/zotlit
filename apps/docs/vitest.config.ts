import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Unit seam only — the app's own Vite config carries the Cloudflare and
// TanStack Start plugins, which neither a pure-function test nor the
// collection index has any use for.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      collections: resolve(import.meta.dirname, ".source"),
    },
  },
  plugins: [fumadocsMdx()],
});
