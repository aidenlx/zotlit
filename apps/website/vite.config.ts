import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import {
  renderHeadersFile,
  renderRedirectsFile,
} from "./src/lib/v1-redirects.ts";

/**
 * Emits the Cloudflare asset-layer rule files into the client build, so legacy
 * permalinks and the giscus CORS header resolve without a Worker invocation.
 * @see src/lib/v1-redirects.ts
 */
function cloudflareAssetRules(): Plugin {
  return {
    name: "zotlit:cloudflare-asset-rules",
    apply: "build",
    generateBundle() {
      if (this.environment.name !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: renderRedirectsFile(),
      });
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: renderHeadersFile(),
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      // fumadocs-mdx writes its collection index files under `.source`
      collections: resolve(import.meta.dirname, ".source"),
    },
    // vite 8 seems to have trouble with tsconfigPaths + tsconfig.app.json
    // define explictly for now
    // tsconfigPaths: true,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    fumadocsMdx(),
    cloudflareAssetRules(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
});
