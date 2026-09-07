import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { agentSkillAssets } from "./src/lib/agent-skills.js";
import { renderHeadersFile } from "./src/lib/headers.js";
import { createOgCardRenderer } from "./src/lib/og-card.js";
import { ogCards } from "./src/lib/og-cards.js";
import { prerenderPages } from "./src/lib/prerender-pages.js";
import { renderRedirectsFile } from "./src/lib/v1-redirects.js";

const packageRoot = import.meta.dirname;
// Keep Miniflare's local Worker registry with the package's other ignored
// runtime state, so a build needs no access to the user's global config path.
process.env.MINIFLARE_REGISTRY_PATH ??= resolve(
  packageRoot,
  ".wrangler/registry",
);
/** The real `fumadocs-core/server`, the entry its `import` condition names. */
const fumadocsServer = fileURLToPath(
  import.meta.resolve("fumadocs-core/server"),
);

/**
 * `fumadocs-core/server` lists its `browser` export condition first, and the
 * Worker carries that condition — `@cloudflare/vite-plugin` resolves `workerd`,
 * `worker`, `module`, `browser` — so the Worker would load the stub whose
 * `renderToMarkdown` throws. The Markdown editions render inside the Worker, so
 * that environment alone takes the real entry; the client keeps the stub, which
 * is what holds Markdown rendering out of its bundle. This is a `resolveId`
 * hook rather than an alias because Vite resolves `resolve.alias` once for
 * every environment, leaving no place to name the Worker on its own.
 */
function fumadocsServerOnWorker(): Plugin {
  return {
    name: "zotlit:fumadocs-server-on-worker",
    enforce: "pre",
    resolveId(source) {
      if (
        source !== "fumadocs-core/server" ||
        this.environment.name !== "ssr"
      ) {
        return undefined;
      }
      return fumadocsServer;
    },
  };
}

let docsLine: Cloudflare.Env["DOCS_LINE"] | undefined;

function resolvedDocsLine(): Cloudflare.Env["DOCS_LINE"] {
  if (docsLine === undefined) {
    throw new Error("Cloudflare configuration did not provide DOCS_LINE.");
  }
  return docsLine;
}

/**
 * Emits the Cloudflare asset-layer rule files into the client build, so legacy
 * permalinks and the giscus CORS header resolve without a Worker invocation.
 * @see src/lib/v1-redirects.ts
 * @see src/lib/headers.ts
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

/**
 * Emits the binary machine assets — the OG cards and the agent-skill archives
 * with their discovery index — into the client build, and serves the same
 * bytes from the dev server.
 *
 * These bypass the prerender pass because it writes every response as text,
 * which a WebP or a zip does not survive. Rendering them here also keeps the
 * native takumi renderer and the workspace file reads in Node, where the
 * Worker runtime cannot reach them.
 */
function machineAssets(): Plugin {
  const renderCard = createOgCardRenderer(packageRoot);
  let skills: Promise<Map<string, Uint8Array>> | undefined;
  const agentSkills = () =>
    (skills ??= agentSkillAssets(packageRoot, resolvedDocsLine()));

  return {
    name: "zotlit:machine-assets",
    async generateBundle() {
      if (this.environment.name !== "client") return;

      const assets = new Map(await agentSkills());
      for (const [path, card] of ogCards(packageRoot)) {
        assets.set(path, await renderCard(card));
      }
      for (const [path, source] of assets) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source });
      }
    },
    configureServer(server) {
      /** The asset's bytes and media type, or undefined when no asset owns the path. */
      async function resolveAsset(path: string) {
        const skill = (await agentSkills()).get(path);
        if (skill) {
          const type = path.endsWith(".json")
            ? "application/json"
            : "application/zip";
          return { type, body: skill };
        }

        const card = ogCards(packageRoot).get(path);
        if (!card) return undefined;
        return { type: "image/webp", body: await renderCard(card) };
      }

      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path) {
          next();
          return;
        }

        try {
          const asset = await resolveAsset(path);
          if (!asset) {
            next();
            return;
          }
          res.setHeader("content-type", asset.type);
          res.end(Buffer.from(asset.body));
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}

/**
 * The render Worker's graph takes no hot update of its own. Vite has no hot
 * channel into a Worker, so an update that reaches the Worker's entry — a
 * module that accepts nothing — falls back to reloading the whole page and
 * drops the editor's state. The scheduler starts a fresh Worker for every
 * render, and the dev server serves each module as it now is, so the next
 * render runs the edit without any update at all. An edit to the entry itself
 * is dropped, and every other module is cut loose from the entry's importer
 * edge before Vite propagates, so an edit inside the Worker's graph stops at
 * the page's own React boundary. Every module is still invalidated. A module
 * only the Worker reads has no importer left once the edge is cut, so an edit
 * to it still reloads the page, as it did before; today every module the
 * Worker reads, the page reads too.
 * @see src/lib/workbench/render-client.ts
 */
function workerHotUpdate(): Plugin {
  const entry = resolve(packageRoot, "src/lib/workbench/render-worker.ts");
  return {
    name: "zotlit:worker-hot-update",
    hotUpdate({ file, modules }) {
      if (this.environment.name !== "client") return;
      if (file === entry) return [];
      for (const worker of this.environment.moduleGraph.getModulesByFile(
        entry,
      ) ?? []) {
        for (const imported of worker.importedModules) {
          imported.importers.delete(worker);
        }
      }
      return modules;
    },
  };
}

export default defineConfig(({ command }) => ({
  // `@base-ui/react` imports the named `useSyncExternalStoreWithSelector` from
  // a CommonJS shim. The dev server serves that file raw unless the pre-bundler
  // is told to convert it, and the missing named export stops hydration before
  // the page becomes interactive. The production build converts it either way.
  optimizeDeps: {
    include: ["@base-ui/react > use-sync-external-store/shim/with-selector"],
    // The Workbench sits behind a dynamic import the router's own entry scan
    // stops short of, so its dependencies — CodeMirror, the Lezer parsers, the
    // template engines, the reading view's parser stack — were found one by
    // one as the page requested them, each round re-optimizing and reloading.
    // Named here, the scan finds them all before the first request.
    entries: ["src/lib/workbench/workbench.tsx"],
  },
  // The Workbench's render Worker is a module Worker: it awaits the Temporal
  // polyfill before it takes its first message, and top-level await needs an
  // ES bundle rather than Vite's default IIFE.
  // @see src/lib/workbench/render-worker.ts
  worker: { format: "es" },
  // Both aliases are declared here rather than through
  // `resolve.tsconfigPaths`, which under Vite 8 leaves the `paths` in
  // `tsconfig.app.json` unresolved.
  resolve: {
    alias: {
      "@": resolve(packageRoot, "src"),
      // fumadocs-mdx writes its collection index files under `.source`
      collections: resolve(packageRoot, ".source"),
    },
  },
  plugins: [
    fumadocsServerOnWorker(),
    paraglideVitePlugin({
      project: "../../project.inlang",
      outdir: "./src/paraglide",
      // Group messages in dev to avoid one HTTP request per message.
      outputStructure:
        command === "serve" ? "locale-modules" : "message-modules",
      strategy: ["baseLocale"],
      emitTsDeclarations: true,
    }),
    devtools(),
    tailwindcss(),
    fumadocsMdx(),
    cloudflareAssetRules(),
    machineAssets(),
    workerHotUpdate(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config(config) {
        const value = config.vars?.DOCS_LINE;
        if (value !== "production" && value !== "beta") {
          throw new Error("DOCS_LINE must be 'production' or 'beta'.");
        }
        docsLine = value;
      },
    }),
    // The Markdown surface, the SEO endpoints, and every build-time-safe HTML
    // page prerender into the client output, so the asset layer answers them
    // without invoking the Worker. Discovery stays off: the routes are listed
    // deliberately, and the request-time ones stay off the list.
    tanstackStart({
      pages: prerenderPages(packageRoot),
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
      },
    }),
    viteReact(),
  ],
}));
