// Paraglide compilation completes before Vite creates environments and scans dependencies.

import { compile } from "@inlang/paraglide-js";
import type { CompilerOptions } from "@inlang/paraglide-js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export type { CompilerOptions } from "@inlang/paraglide-js";

const defaultIsServer = "import.meta.env?.SSR ?? typeof window === 'undefined'";

/** Compile a Paraglide facade without starting Vite. */
export async function generateParaglide(
  options: CompilerOptions,
): Promise<void> {
  await compile({
    ...options,
    isServer: options.isServer ?? defaultIsServer,
  });
}

/**
 * Uses Paraglide's compiler and incremental output cache with Vite-owned watching.
 * Initial generation runs in `config`: framework plugins can scan dependencies
 * before `buildStart`, including when their generated imports do not yet exist.
 * @see https://github.com/opral/paraglide-js/blob/abeba5009e22761518964dcfc1ec8f49d4551f41/src/bundler-plugins/unplugin.ts
 */
export function paraglideVitePlugin(options: CompilerOptions): Plugin {
  let previous: Awaited<ReturnType<typeof compile>> | undefined;
  let compilation: Promise<void> = Promise.resolve();
  let inputs = new Set<string>();
  let reads = new Set<string>();
  let paths: CompilerOptions;
  let outputStructure: CompilerOptions["outputStructure"];
  let production = false;
  let closed = false;

  function track(path: fs.PathLike | number): void {
    reads.add(
      resolve(path instanceof URL ? fileURLToPath(path) : path.toString()),
    );
  }

  const sourceFs = options.fs ?? fs;
  const trackedFs = {
    ...sourceFs,
    readFile: new Proxy(sourceFs.readFile, {
      apply(target, receiver, args: Parameters<typeof fs.readFile>) {
        track(args[0]);
        return Reflect.apply(target, receiver, args);
      },
    }),
    readFileSync: new Proxy(sourceFs.readFileSync, {
      apply(target, receiver, args: Parameters<typeof fs.readFileSync>) {
        track(args[0]);
        return Reflect.apply(target, receiver, args);
      },
    }),
    promises: {
      ...sourceFs.promises,
      readFile: new Proxy(sourceFs.promises.readFile, {
        apply(target, receiver, args: Parameters<typeof fs.promises.readFile>) {
          const path = args[0];
          if (
            typeof path === "string" ||
            Buffer.isBuffer(path) ||
            path instanceof URL
          ) {
            track(path);
          }
          return Reflect.apply(target, receiver, args);
        },
      }),
    },
  };

  function ignored(path: string): boolean {
    return [paths.outdir, resolve(paths.project, "cache")].some(
      (directory) =>
        path === directory || path.startsWith(`${directory}${sep}`),
    );
  }

  async function existingOutputHashes(): Promise<Record<string, string>> {
    let entries: fs.Dirent[];
    try {
      entries = await sourceFs.promises.readdir(paths.outdir, {
        recursive: true,
        withFileTypes: true,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {};
      throw error;
    }
    const hashes: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = resolve(entry.parentPath, entry.name);
      const content = await sourceFs.promises.readFile(path, "utf8");
      // Paraglide's writer hashes content plus its absolute destination.
      hashes[relative(paths.outdir, path).split(sep).join("/")] = createHash(
        "sha256",
      )
        .update(content + path)
        .digest("hex");
    }
    return hashes;
  }

  function watchPaths(): string[] {
    return [
      ...new Set([...inputs].flatMap((file) => [file, dirname(file)])),
    ].filter((path) => !ignored(path));
  }

  async function generate(): Promise<void> {
    reads = new Set();
    try {
      previous = await compile({
        ...paths,
        fs: trackedFs,
        previousCompilation: options.cleanOutdir ? undefined : previous,
        cleanOutdir: options.cleanOutdir ?? false,
        outputStructure,
        isServer: options.isServer ?? defaultIsServer,
      });
      inputs = reads;
    } catch (error) {
      inputs = new Set([...inputs, ...reads]);
      previous = undefined;
      throw error;
    }
  }

  return {
    name: "zotlit:paraglide",
    enforce: "pre",
    async config(config, environment) {
      const root = resolve(config.root ?? process.cwd());
      paths = {
        ...options,
        project: resolve(root, options.project),
        outdir: resolve(root, options.outdir),
      };
      production = environment.command === "build";
      outputStructure =
        options.outputStructure ??
        (production ? "message-modules" : "locale-modules");
      // Awaited config hooks precede every environment's dependency scanner.
      if (!options.cleanOutdir)
        previous = { outputHashes: await existingOutputHashes() };
      await generate();
    },
    buildStart() {
      for (const path of watchPaths()) this.addWatchFile(path);
    },
    async watchChange(path) {
      if (closed) return;
      const changed = resolve(path);
      if (
        ignored(changed) ||
        !watchPaths().some(
          (input) => changed === input || changed.startsWith(`${input}${sep}`),
        )
      )
        return;
      // Vite can report several edits while the compiler is still writing.
      const next = compilation.then(() => generate());
      compilation = next.catch(() => {});
      try {
        await next;
      } catch (error) {
        if (production) throw error;
        this.warn(`Paraglide compilation failed: ${String(error)}`);
      } finally {
        for (const input of watchPaths()) this.addWatchFile(input);
      }
    },
    async closeBundle() {
      closed = true;
      await compilation;
    },
  };
}
