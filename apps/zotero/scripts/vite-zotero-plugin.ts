import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import type { InlineConfig, LibraryFormats, Plugin } from "vite";

import { parseManifest } from "./manifest.js";

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
  addonStaging: string;
  xpiOutDir: string;
  isProd: boolean;
}

export function zoteroBuildPlugin({
  root,
  addonStaging,
  xpiOutDir,
  isProd,
}: ZoteroBuildPluginOpts): Plugin {
  const pkgPath = join(root, "package.json");
  const addonSrcDir = join(root, "addon");
  const addonDistDir = join(root, addonStaging);
  const xpiAbsoluteOutDir = join(root, xpiOutDir);

  return {
    name: "zotero-build",
    buildStart() {
      this.addWatchFile(pkgPath);
      this.addWatchFile(addonSrcDir);
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
