// Vite plugin that compiles Language Packs on build and optionally serves them over loopback.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

import { compile, resolveCompilePaths } from "./compiler.js";
import type { CompileOptions } from "./compiler.js";
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
    async config(userConfig) {
      let build: { watch: { exclude: string[] } } | undefined;
      const { outputDirectory } = resolveCompilePaths({
        ...options,
        root: userConfig.root,
      });
      if (userConfig.build?.watch) {
        build = { watch: { exclude: [`${outputDirectory}/**`] } };
      }
      const serverUrl =
        options.servePacks === undefined
          ? undefined
          : await startPackServer(outputDirectory, options.servePacks.port);
      const define =
        serverUrl === undefined
          ? undefined
          : {
              __LANGUAGE_PACK_DEV_SERVER__: JSON.stringify(serverUrl),
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

  async function startPackServer(
    packDirectory: string,
    port: number,
  ): Promise<string> {
    await using resources = new AsyncDisposableStack();
    const server = createServer(async (request, response) => {
      const fileName = request.url?.slice(1) ?? "";
      try {
        if (!isLanguagePackFileName(fileName)) {
          throw new Error("Unsupported Language Pack path");
        }
        const contents = await readFile(join(packDirectory, fileName), "utf8");
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
    const address = await new Promise<{ port: number }>(
      (resolveListen, rejectListen) => {
        const onError = (error: Error): void => rejectListen(error);
        server.once("error", onError);
        server.listen(port, PACK_SERVER_HOST, () => {
          server.off("error", onError);
          const address = server.address();
          if (address === null || typeof address === "string") {
            rejectListen(new Error("Expected a TCP address"));
            return;
          }
          resolveListen(address);
        });
      },
    );
    server.unref();
    const url = `http://${PACK_SERVER_HOST}:${address.port}`;
    console.log("serving language packs on port", address.port);
    packServer = resources.move();
    return url;
  }
}
