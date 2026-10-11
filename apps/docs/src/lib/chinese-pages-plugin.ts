import { resolve } from "node:path";
import { normalizePath } from "vite";
import type { Plugin } from "vite";

import { scanChinesePages } from "./content-scan.js";

/** Keep locale metadata aligned with the native content inventory. */
export function chinesePagesPlugin(packageRoot: string): Plugin {
  const inventory = () => JSON.stringify(scanChinesePages(packageRoot).sort());
  const contentRoot = `${normalizePath(resolve(packageRoot, "content"))}/`;
  return {
    name: "zotlit:chinese-pages",
    config() {
      return {
        define: {
          __DOCS_CHINESE_PAGES__: inventory(),
        },
      };
    },
    configureServer(server) {
      async function refresh(path: string) {
        if (
          normalizePath(path).startsWith(contentRoot) &&
          (path.endsWith(".zh-CN.mdx") || path.endsWith(".zh-CN.md"))
        ) {
          // Fumadocs refreshes its collections on file changes. Re-run the
          // config too so browser/SSR defines and prerender metadata agree.
          await server.restart();
          // Vite coalesces restarts. A checkout can add more translations after
          // that restart scanned the files, so carry those changes through too.
          if (server.config.define?.__DOCS_CHINESE_PAGES__ !== inventory()) {
            await server.restart();
          }
        }
      }
      server.watcher.on("add", refresh).on("unlink", refresh);
    },
  };
}
