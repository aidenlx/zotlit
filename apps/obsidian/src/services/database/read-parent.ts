// Where a database read snapshot is placed, and why.

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";

/** Why {@link planReadParents} ordered the parents the way it did. */
export type ReadParentReason =
  | "cross-volume"
  | "same-volume"
  | "unknown-volume"
  | "network-path";

export interface ReadParentPlan {
  /** Candidates in preference order; the first that accepts a snapshot wins. */
  parents: [string, ...string[]];
  reason: ReadParentReason;
}

export interface ReadParentInputs {
  databasePath: string;
  /** `stat` device id of the system temp folder. `0n` where it is unknown. */
  tempDevice: bigint;
  /** `stat` device id of the Zotero data directory. `0n` where it is unknown. */
  databaseDevice: bigint;
}

/**
 * Cloning never crosses a volume boundary: a macOS/Linux reflink fails outright,
 * and the Windows `CopyFile` block clone silently degrades to a byte copy. So a
 * snapshot leaves the system temp folder only when the temp folder sits on
 * another volume than the database, and then it goes into a namespaced folder
 * beside the database, with the temp folder kept as the fallback.
 *
 * Device equality is a necessary condition for cloning, never a sufficient one —
 * the clone attempt and its error classification stay the authority. Two cases
 * therefore hold the snapshot in the temp folder rather than guess:
 *
 * - An unknown device id (`0n`, which some Windows network and FUSE drivers
 *   report) says nothing about the volumes, so it never moves the snapshot.
 * - A UNC database path is a network share, which no client can block-clone;
 *   writing a multi-hundred-MB snapshot over the wire would be pure cost.
 */
export function planReadParents({
  databasePath,
  tempDevice,
  databaseDevice,
}: ReadParentInputs): ReadParentPlan {
  const temp = tmpdir();
  if (isUncPath(databasePath))
    return { parents: [temp], reason: "network-path" };
  if (tempDevice === 0n || databaseDevice === 0n)
    return { parents: [temp], reason: "unknown-volume" };
  if (tempDevice === databaseDevice)
    return { parents: [temp], reason: "same-volume" };
  return {
    parents: [readParentBeside(databasePath), temp],
    reason: "cross-volume",
  };
}

/**
 * The one place the diverted parent's path is derived, so the sweep that reaps
 * it cannot drift from the placement that fills it.
 */
export function readParentBeside(databasePath: string): string {
  return join(dirname(databasePath), ZOTERO_DB_READ_PARENT_DIRNAME);
}

const UNC_PREFIX = "\\\\";
const LONG_PATH_PREFIX = "\\\\?\\";
const LONG_UNC_PREFIX = "\\\\?\\UNC\\";

/**
 * `\\server\share\…` and its long form `\\?\UNC\server\share\…` are shares;
 * `\\?\D:\…` is the long form of a local path and is not one.
 */
function isUncPath(path: string): boolean {
  if (!path.startsWith(UNC_PREFIX)) return false;
  if (!path.startsWith(LONG_PATH_PREFIX)) return true;
  return path.toUpperCase().startsWith(LONG_UNC_PREFIX);
}
