// Vite plugin that compiles Language Packs on build and optionally serves them over loopback.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { type Plugin, type ResolvedConfig } from "vite";

import {
  compile,
  resolveCompilePaths,
  type CompileOptions,
} from "./compiler.js";
import { isLanguagePackFileName } from "./language-pack.js";

export type ObsidianI18nViteOptions = Omit<CompileOptions, "root"> & {
  servePacks?: {
    port: number;
  };
};

const PACK_SERVER_HOST = "127.0.0.1";

export function obsidianI18n(options: ObsidianI18nViteOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let packServer: AsyncDisposableStack | undefined;

  return {
    name: "obsidian-i18n",
    config(userConfig) {
      let build: { watch: { exclude: string[] } } | undefined;
      if (userConfig.build?.watch) {
        const { outputDirectory } = resolveCompilePaths({
          ...options,
          root: userConfig.root,
        });
        build = { watch: { exclude: [`${outputDirectory}/**`] } };
      }
      const define =
        options.servePacks === undefined
          ? undefined
          : {
              __LANGUAGE_PACK_DEV_SERVER__: JSON.stringify(
                `http://${PACK_SERVER_HOST}:${options.servePacks.port}`,
              ),
            };
      if (build === undefined && define === undefined) return;
      return { build, define };
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      const result = await compile({ ...options, root: config?.root });
      for (const watchPath of result.watchPaths) {
        this.addWatchFile(watchPath);
      }
      if (result.warnings.length > 0) this.warn(result.warnings.join("\n"));

      if (options.servePacks !== undefined && packServer === undefined) {
        await using resources = new AsyncDisposableStack();
        const { port } = options.servePacks;
        console.log("serving language packs on port", port);
        const packDirectory = result.outputDirectory;
        const server = createServer(async (request, response) => {
          const fileName = request.url?.slice(1) ?? "";
          try {
            if (!isLanguagePackFileName(fileName)) {
              throw new Error("Unsupported Language Pack path");
            }
            const contents = await readFile(
              join(packDirectory, fileName),
              "utf8",
            );
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(contents);
          } catch {
            response.writeHead(404);
            response.end();
          }
        });
        resources.defer(async () => {
          if (server.listening) await server[Symbol.asyncDispose]();
        });
        await new Promise<void>((resolveListen, rejectListen) => {
          const onError = (error: Error): void => rejectListen(error);
          server.once("error", onError);
          server.listen(port, PACK_SERVER_HOST, () => {
            server.off("error", onError);
            resolveListen();
          });
        });
        server.unref();
        packServer = resources.move();
      }
    },
    /**
     * Only `closeWatcher` tears the pack server down: watch builds close the
     * bundle after every rebuild, and the plugin fetches its pack between them.
     */
    async closeWatcher() {
      await packServer?.disposeAsync();
      packServer = undefined;
    },
  };
}
