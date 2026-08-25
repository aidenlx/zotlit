import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

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
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
});
