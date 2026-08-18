// Walks one temp directory and removes the entries a caller calls residue.
//
// Owns the mechanics every sweep repeats — the walk, the abort checks, the
// removal, and the logging — and nothing about what counts as residue. Each
// producer of temp entries keeps that rule in its own `reap-temps.ts`, next to
// the code that writes the entries the rule recognizes.
//
// A sweep never throws: a directory that refuses to be listed or emptied is a
// logged warning, never a failed launch.

import { opendir, rm } from "node:fs/promises";
import { join } from "node:path";

import { isErrno } from "./errno";
import { getLogger } from "./log";

const logger = getLogger("temp-sweep");

/** What every reap step accepts, so one startup passes the same thing to each. */
export interface ReapTempsOptions {
  signal?: AbortSignal;
  /**
   * The directory the producer writes into.
   *
   * @default tmpdir()
   */
  parent?: string;
}

export interface TempSweepOptions {
  /** The directory to walk. Absent is the normal state before a first run. */
  directory: string;
  /** Names the swept entry in logs, e.g. `"database read clone"`. */
  kind: string;
  /** Whether this entry is residue no run still needs. */
  isResidue: (name: string, path: string) => Promise<boolean> | boolean;
  signal?: AbortSignal;
}

export async function sweepTempDirectory({
  directory,
  kind,
  isResidue,
  signal,
}: TempSweepOptions): Promise<void> {
  try {
    signal?.throwIfAborted();
    await using dir = await opendir(directory);
    for await (const entry of dir) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name);
      if (await isResidue(entry.name, path)) await remove(path, kind);
    }
  } catch (error) {
    if (signal?.aborted || isErrno(error, "ENOENT")) return;
    logger.warn("Failed to sweep a ZotLit temp directory", {
      error,
      directory,
      kind,
    });
  }
}

async function remove(path: string, kind: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
    logger.debug("Reaped a stale ZotLit temp entry", { path, kind });
  } catch (error) {
    logger.warn("Failed to reap a stale ZotLit temp entry", {
      error,
      path,
      kind,
    });
  }
}
