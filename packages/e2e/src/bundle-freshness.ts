// Stops an End-to-end Run that would install a dev plugin bundle older than
// the sources that feed it. Root `pnpm e2e` rebuilds the bundle first; a direct
// `vitest run` installs whatever bundle is on disk.

import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REBUILD_COMMAND =
  "pnpm exec turbo run build:dev --filter=@zotlit/obsidian";

export interface BundleInput {
  /** Path relative to the workspace root. */
  path: string;
  mtimeMs: number;
}

/** Test and benchmark files sit beside the sources but never enter the bundle. */
const OUTSIDE_BUNDLE = /\.(?:test|bench)\.[cm]?[jt]sx?$/;

/**
 * The newest bundle input written after the bundle, or `undefined` when the
 * bundle is current.
 */
export function newerInput(
  bundleMtimeMs: number,
  inputs: Iterable<BundleInput>,
): BundleInput | undefined {
  let newest: BundleInput | undefined;
  for (const input of inputs) {
    if (OUTSIDE_BUNDLE.test(input.path)) continue;
    if (input.mtimeMs <= bundleMtimeMs) continue;
    if (!newest || input.mtimeMs > newest.mtimeMs) newest = input;
  }
  return newest;
}

/** Workspace packages the plugin bundles, followed through their own dependencies. */
async function bundledPackageDirs(appDir: string): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string> };
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (!version.startsWith("workspace:")) continue;
      const depDir = await realpath(join(dir, "node_modules", name));
      if (found.has(depDir)) continue;
      found.add(depDir);
      await visit(depDir);
    }
  };
  await visit(appDir);
  return [...found];
}

/** Git-visible files under the bundle's inputs, so ignored generated output stays out. */
async function readBundleInputs(
  workspaceRoot: string,
  appDir: string,
): Promise<BundleInput[]> {
  const pathspecs = [
    join(appDir, "src"),
    join(appDir, "package.json"),
    join(appDir, "vite.config.ts"),
    join(workspaceRoot, "messages"),
    join(workspaceRoot, "project.inlang", "settings.json"),
    join(workspaceRoot, "assets", "logo"),
    ...(await bundledPackageDirs(appDir)).map((dir) => join(dir, "src")),
  ].map((path) => relative(workspaceRoot, path));
  const { stdout } = await execFileAsync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...pathspecs,
    ],
    { cwd: workspaceRoot, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const paths = [...new Set(stdout.split("\0").filter(Boolean))];
  const inputs = await Promise.all(
    paths.map(async (path) => {
      // A tracked file deleted in the working tree is no longer an input.
      const stats = await stat(join(workspaceRoot, path)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      return stats && { path, mtimeMs: stats.mtimeMs };
    }),
  );
  return inputs.filter((input) => input !== undefined);
}

/**
 * Throw when `apps/obsidian/dist-dev` is missing or older than a source input,
 * naming the command that rebuilds it.
 */
export async function assertDevBundleFresh(
  workspaceRoot: string,
): Promise<void> {
  const appDir = join(workspaceRoot, "apps", "obsidian");
  const bundlePath = join(appDir, "dist-dev", "main.js");
  const bundle = await stat(bundlePath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!bundle) {
    throw new Error(
      `No dev plugin bundle at ${relative(workspaceRoot, bundlePath)}. Build it:\n  ${REBUILD_COMMAND}`,
    );
  }
  const newer = newerInput(
    bundle.mtimeMs,
    await readBundleInputs(workspaceRoot, appDir),
  );
  if (newer) {
    throw new Error(
      `The dev plugin bundle ${relative(workspaceRoot, bundlePath)} is older than ${newer.path}. Rebuild it:\n  ${REBUILD_COMMAND}`,
    );
  }
}
