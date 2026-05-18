import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { build } from "vite";
import type { InlineConfig, LibraryFormats, Plugin } from "vite";

import { parseManifest } from "./manifest.js";

type BuildResult = Awaited<ReturnType<typeof build>>;
// build() can return a watcher when build.watch is set; we don't set that
// on the inner config, so narrow off the watcher branch structurally.
type BuildOutput = Exclude<BuildResult, { close: unknown }>;

async function addWatchTree(
  addWatchFile: (id: string) => void,
  dir: string,
): Promise<void> {
  addWatchFile(dir);
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await addWatchTree(addWatchFile, path);
    } else if (entry.isFile()) {
      addWatchFile(path);
    }
  }
}

export interface ZoteroBuildEnv {
  mode: string;
  isProd: boolean;
  isDev: boolean;
  addonStaging: string;
  xpiOutDir: string;
}

export function resolveEnv(mode: string): ZoteroBuildEnv {
  const isProd = mode === "production";
  const isDev = mode === "development";
  return {
    mode,
    isProd,
    isDev,
    addonStaging: isProd ? "dist/addon" : "dist-dev/addon",
    xpiOutDir: isProd ? "dist" : "dist-dev",
  };
}

export interface ZoteroIifeBundleOpts {
  entry: string;
  iifeName: string;
  fileName: string;
  exports: readonly string[];
  emptyOutDir?: boolean;
  /** @default "es2022" */
  target?: string;
}

/** Zotero sandbox: chrome-privileged JS scope, no modules, no DOM globals. */
export function zoteroSandboxConfig(
  root: string,
  env: ZoteroBuildEnv,
  bundle: ZoteroIifeBundleOpts,
): InlineConfig {
  return {
    configFile: false,
    mode: env.mode,
    resolve: { tsconfigPaths: true },
    define: {
      __DEV__: JSON.stringify(env.isDev),
      "process.env.NODE_ENV": JSON.stringify(env.mode),
    },
    build: {
      lib: {
        entry: resolve(root, bundle.entry),
        formats: ["iife"] satisfies LibraryFormats[],
        name: bundle.iifeName,
        fileName: () => bundle.fileName,
      },
      outDir: env.addonStaging,
      emptyOutDir: bundle.emptyOutDir ?? false,
      sourcemap: false,
      minify: env.isProd,
      target: bundle.target ?? "es2022",
      copyPublicDir: false,
      rolldownOptions: {
        output: {
          banner: `/* GENERATED ${bundle.fileName} — DO NOT EDIT */`,
          footer: bundle.exports
            .map((name) => `var ${name} = ${bundle.iifeName}.${name};`)
            .join("\n"),
          codeSplitting: false,
        },
      },
    },
  };
}

export interface ZoteroBuildPluginOpts {
  root: string;
  env: ZoteroBuildEnv;
  bootstrapBundle: ZoteroIifeBundleOpts;
}

export function zoteroBuildPlugin({
  root,
  env,
  bootstrapBundle,
}: ZoteroBuildPluginOpts): Plugin {
  const { addonStaging, xpiOutDir, isProd } = env;
  const pkgPath = join(root, "package.json");
  const addonSrcDir = join(root, "addon");
  const addonDistDir = join(root, addonStaging);
  const bootstrapEntryPath = resolve(root, bootstrapBundle.entry);
  const xpiAbsoluteOutDir = join(root, xpiOutDir);

  return {
    name: "zotero-build",
    async buildStart() {
      // Wipe staging every rebuild so deletions or renames under addon/ —
      // and stale bundle chunks from prior runs — don't leak into the XPI.
      // Safe to do here because both bundle writes happen after buildStart.
      await rm(addonDistDir, { recursive: true, force: true });

      // Register stable watch paths before the inner build so a failing
      // bootstrap build still leaves the entry file under watch; otherwise
      // the dev's next save can't trigger a retry.
      this.addWatchFile(pkgPath);
      this.addWatchFile(bootstrapEntryPath);
      await addWatchTree(this.addWatchFile.bind(this), addonSrcDir);

      const result = (await build(
        zoteroSandboxConfig(root, env, bootstrapBundle),
      )) as BuildOutput;
      const outputs = Array.isArray(result) ? result : [result];
      for (const { output } of outputs) {
        for (const chunk of output) {
          if (chunk.type !== "chunk") continue;
          for (const id of chunk.moduleIds) this.addWatchFile(id);
        }
      }
    },
    async writeBundle() {
      const pkgRaw = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgRaw) as Parameters<typeof parseManifest>[0];
      const manifest = parseManifest(pkg);

      // bootstrap.js (from the inner build) and main.js (just written) are
      // both in `outDir`. Overlay the static addon assets on top.
      await cp(addonSrcDir, addonDistDir, { recursive: true });

      await writeFile(
        join(addonDistDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      const xpiName = isProd
        ? `zotlit-zotero-${pkg.version}.xpi`
        : `zotlit-zotero-${pkg.version}-dev.xpi`;
      await mkdir(xpiAbsoluteOutDir, { recursive: true });
      const xpiPath = join(xpiAbsoluteOutDir, xpiName);
      const zip = new AdmZip();
      zip.addLocalFolder(addonDistDir);
      zip.writeZip(xpiPath);
      console.log(`Wrote ${xpiName}`);
    },
  };
}
