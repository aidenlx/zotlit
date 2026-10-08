// What counts as a stale database read clone, next to the code that makes one.

import { tmpdir } from "node:os";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { isErrno } from "@/lib/errno";
import { sweepTempDirectory } from "@/lib/temp-sweep";
import type { ReapTempsOptions } from "@/lib/temp-sweep";

/**
 * Remove clone temp dirs left behind by crashed runs. Each dir is tagged with
 * its owner PID by `prepareRead`, and its owner disposes it at the end of the
 * read, so a dir tagged with a dead PID is the residue of a crash. Dirs
 * owned by this process or by any still-live process are kept, so a
 * concurrently-running Obsidian never has its active clones reaped.
 */
export async function reapReadClones({
  signal,
  parent = tmpdir(),
}: ReapTempsOptions = {}): Promise<void> {
  await sweepTempDirectory({
    directory: parent,
    kind: "database read clone",
    signal,
    isResidue: (name) => {
      const pid = parseTempPid(name);
      return pid !== null && pid !== process.pid && !isPidLive(pid);
    },
  });
}

/**
 * Remove the clone temp dirs a database worker left behind, once that worker
 * is gone. A dir carries its worker's owner tag after the PID (see
 * `prepareRead`), and every worker of this process shares the PID, so the tag
 * alone tells a dead worker's residue from the clone a live worker reads.
 * Dirs without that tag are kept for {@link reapReadClones} at the next launch.
 */
export async function reapWorkerClones({
  owner,
  parents,
}: {
  /** The tag the gone worker named its clones with. */
  owner: string;
  /** Every directory that worker may have placed a clone in. */
  parents: readonly string[];
}): Promise<void> {
  await Promise.all(
    parents.map((directory) =>
      sweepTempDirectory({
        directory,
        kind: "database read clone",
        isResidue: (name) => parseTempOwner(name) === owner,
      }),
    ),
  );
}

/** The owner tag after the PID, or `null` for a dir that carries none. */
function parseTempOwner(entry: string): string | null {
  if (parseTempPid(entry) === null) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const tagged = rest.slice(rest.indexOf("-") + 1);
  const end = tagged.indexOf("-");
  return end > 0 ? tagged.slice(0, end) : null;
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
