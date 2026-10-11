// Node-only: reads the Template Directory folder of the checked-out repository.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { DirectoryFiles } from "./load.ts";

/** The Directory's place in the repository, below the workspace root. */
const DIRECTORY_PATH = ["docs", "template-directory"] as const;

export async function templateDirectoryRoot(): Promise<string> {
  return join(await getWorkspaceRoot(import.meta.dirname), ...DIRECTORY_PATH);
}

/** Every file below `root` except dotfiles, keyed by its `/`-separated relative path. */
export async function readTemplateDirectory(
  root: string,
): Promise<DirectoryFiles> {
  const dirents = await readdir(root, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    dirents
      .filter((dirent) => dirent.isFile())
      .map((dirent) => join(dirent.parentPath, dirent.name))
      .filter((path) =>
        relative(root, path)
          .split(sep)
          .every((segment) => !segment.startsWith(".")),
      )
      .map(
        async (path) =>
          [
            relative(root, path).split(sep).join("/"),
            await readFile(path, "utf8"),
          ] as const,
      ),
  );
  return new Map(files.sort(([a], [b]) => a.localeCompare(b)));
}
