import { opendir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";

const logger = getLogger(["database", "read-source", "reap"]);

/**
 * Remove clone temp dirs left behind by crashed runs. Each dir is tagged with
 * its owner PID; dirs owned by this process or by any still-live process are
 * kept, so a concurrently-running Obsidian (this one or another) never has its
 * active clones reaped. Runs fire-and-forget at startup and never throws.
 */
export async function reapStaleReadTemps(signal?: AbortSignal): Promise<void> {
  const parent = tmpdir();
  let dir: Awaited<ReturnType<typeof opendir>>;
  try {
    signal?.throwIfAborted();
    dir = await opendir(parent);
  } catch (error) {
    if (signal?.aborted) return;
    logger.warn("Failed to list stale database read temps", { error, parent });
    return;
  }

  try {
    for await (const entry of dir) {
      signal?.throwIfAborted();
      const pid = parseTempPid(entry.name);
      if (pid === null || pid === process.pid || isPidLive(pid)) continue;

      const path = join(parent, entry.name);
      try {
        await rm(path, { recursive: true, force: true });
        logger.debug("Removed stale database read temp", { path, pid });
      } catch (error) {
        logger.warn("Failed to remove stale database read temp", {
          error,
          path,
          pid,
        });
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    logger.warn("Failed to reap stale database read temps", { error, parent });
  }
}

function parseTempPid(entry: string): number | null {
  if (!entry.startsWith(ZOTERO_DB_READ_TEMP_PREFIX)) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const end = rest.indexOf("-");
  if (end <= 0) return null;
  const pid = Number(rest.slice(0, end));
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the PID exists but is owned by another user — still live.
    return isErrno(error, "EPERM");
  }
}
