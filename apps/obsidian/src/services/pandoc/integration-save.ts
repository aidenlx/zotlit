// Transactional save for one user-chosen Pandoc Integration Pair folder.

import {
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";

export interface IntegrationFileSystem {
  readFile: (path: string) => Promise<string>;
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (path: string, value: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
}

export type SavePandocIntegrationResult =
  | { kind: "cancelled" }
  | { kind: "saved"; folder: string }
  | { kind: "failed"; error: unknown; restored: boolean };

export interface SavePandocIntegrationOptions {
  folder: string;
  files: Readonly<Record<string, string>>;
  confirmReplacement: (filenames: readonly string[]) => Promise<boolean>;
  fileSystem?: IntegrationFileSystem;
}

const nodeFileSystem: IntegrationFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  mkdtemp,
  writeFile: async (path, value) => {
    await writeFile(path, value, { flag: "wx" });
  },
  rename,
  unlink,
  rm: async (path) => {
    await rm(path, { recursive: true, force: true });
  },
};

interface PairEntry {
  filename: string;
  contents: string;
  target: string;
  previous: string | null;
}

/**
 * Save both integration files as one transaction. A failed install removes
 * newly installed files and restores every target moved to backup.
 */
export async function savePandocIntegrationFiles({
  folder,
  files,
  confirmReplacement,
  fileSystem = nodeFileSystem,
}: SavePandocIntegrationOptions): Promise<SavePandocIntegrationResult> {
  try {
    const entries = await Promise.all(
      Object.entries(files).map(
        async ([filename, contents]): Promise<PairEntry> => {
          const target = join(folder, filename);
          return {
            filename,
            contents,
            target,
            previous: await readOptional(fileSystem, target),
          };
        },
      ),
    );
    const existing = entries
      .filter((entry) => entry.previous !== null)
      .map((entry) => entry.filename);
    if (existing.length > 0 && !(await confirmReplacement(existing))) {
      return { kind: "cancelled" };
    }

    await using temp = await createTempDirectory(fileSystem, folder);
    for (const entry of entries) {
      await fileSystem.writeFile(
        join(temp.path, entry.filename),
        entry.contents,
      );
    }

    const backedUp: PairEntry[] = [];
    const installed: PairEntry[] = [];
    try {
      for (const entry of entries) {
        if (entry.previous === null) continue;
        await fileSystem.rename(
          entry.target,
          join(temp.path, `.previous-${entry.filename}`),
        );
        backedUp.push(entry);
      }
      for (const entry of entries) {
        await fileSystem.rename(join(temp.path, entry.filename), entry.target);
        installed.push(entry);
      }
    } catch (error) {
      const rollbackErrors = await rollback({
        fileSystem,
        tempPath: temp.path,
        installed,
        backedUp,
      });
      return {
        kind: "failed",
        restored: rollbackErrors.length === 0,
        error:
          rollbackErrors.length === 0
            ? error
            : new AggregateError(
                [error, ...rollbackErrors],
                "Failed to save and restore the Pandoc Integration Pair",
              ),
      };
    }

    return { kind: "saved", folder };
  } catch (error) {
    return { kind: "failed", error, restored: true };
  }
}

async function readOptional(
  fileSystem: IntegrationFileSystem,
  path: string,
): Promise<string | null> {
  try {
    return await fileSystem.readFile(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

async function createTempDirectory(
  fileSystem: IntegrationFileSystem,
  folder: string,
): Promise<{ path: string } & AsyncDisposable> {
  const path = await fileSystem.mkdtemp(join(folder, ".zotlit-pandoc-"));
  return {
    path,
    async [Symbol.asyncDispose]() {
      // The pair result is authoritative after the target renames complete;
      // a stale private staging folder does not turn that save into a failure.
      await fileSystem.rm(path).catch(() => undefined);
    },
  };
}

async function rollback({
  fileSystem,
  tempPath,
  installed,
  backedUp,
}: {
  fileSystem: IntegrationFileSystem;
  tempPath: string;
  installed: readonly PairEntry[];
  backedUp: readonly PairEntry[];
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const entry of installed.toReversed()) {
    try {
      await fileSystem.unlink(entry.target);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) errors.push(error);
    }
  }
  for (const entry of backedUp.toReversed()) {
    try {
      await fileSystem.rename(
        join(tempPath, `.previous-${entry.filename}`),
        entry.target,
      );
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
