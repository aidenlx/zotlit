import { regex } from "arkregex";
import { cp, lstat, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import type { FixtureLayout } from "./layout.ts";

async function forkPath(layout: FixtureLayout, name: string): Promise<string> {
  if (!regex("^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$").test(name))
    throw new Error(
      "Use a fork name of 1–64 letters, digits, hyphens or underscores, starting with a letter or digit.",
    );
  const parent = resolve(layout.root, "forks");
  await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink())
    throw new Error(
      `Fixture forks directory must be a real directory: ${parent}`,
    );
  return join(parent, name);
}

/** Copy owned assets and a consistent SQLite snapshot, including committed WAL data. */
export async function forkFixtureData(
  layout: FixtureLayout,
  name: string,
): Promise<string> {
  try {
    await stat(layout.databasePath);
  } catch (error) {
    throw new Error(
      "Build the Fixture with pnpm fixture before forking its Zotero data.",
      { cause: error },
    );
  }
  const destination = await forkPath(layout, name);
  // Exclusive creation keeps an existing fork and its edits intact.
  await mkdir(destination);
  try {
    const databaseFiles = new Set(
      [
        "zotero.sqlite",
        "zotero.sqlite-wal",
        "zotero.sqlite-shm",
        "zotero.sqlite-journal",
      ].map((file) => join(layout.dataDir, file)),
    );
    await cp(layout.dataDir, destination, {
      recursive: true,
      dereference: true,
      filter: (source) => !databaseFiles.has(source),
    });
    using database = new DatabaseSync(layout.databasePath, { readOnly: true });
    await backup(database, join(destination, "zotero.sqlite"));
    return destination;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

/** Remove only the named fork; the built data and committed template stay intact. */
export async function removeFixtureFork(
  layout: FixtureLayout,
  name: string,
): Promise<void> {
  await rm(await forkPath(layout, name), { recursive: true, force: true });
}
