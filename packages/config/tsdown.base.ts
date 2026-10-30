// Turbo tasks of other runs read a library's dist while it builds: a test, the
// lint, the End-to-end Run. tsdown's default `clean` empties dist for the whole
// build (about 1 s for @zotlit/db), and each import of the package fails in
// that window. A library built with this preset overwrites its files in place,
// then removes the files the build did not emit.

import { readdir, rm, rmdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

/** `defineConfig` for a workspace library whose dist stays readable during a build. */
export function defineLibrary(
  config: Omit<UserConfig, "clean" | "hooks">,
): UserConfig {
  return defineConfig({
    ...config,
    clean: false,
    hooks: {
      "build:done": ({ options, chunks }) =>
        pruneUnemitted(
          options.outDir,
          chunks.map((chunk) => chunk.fileName),
        ),
    },
  });
}

/**
 * Remove each file in `outDir` outside `emitted`, and each folder this
 * leaves empty. `emitted` holds paths relative to `outDir`, joined by `/`.
 */
export async function pruneUnemitted(
  outDir: string,
  emitted: Iterable<string>,
): Promise<void> {
  const keep = new Set(emitted);
  const entries = await readdir(outDir, {
    recursive: true,
    withFileTypes: true,
  });
  const folders: string[] = [];
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) folders.push(path);
    else if (!keep.has(relative(outDir, path).split(sep).join("/"))) {
      await rm(path, { force: true });
    }
  }
  // Deepest first, so a parent is empty once its children are gone.
  for (const folder of folders.toSorted((a, b) => b.length - a.length)) {
    await rmdir(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOTEMPTY") throw error;
    });
  }
}
