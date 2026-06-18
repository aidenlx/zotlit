import { sourceIdFromUris } from "@zotlit/protocol";

import { logger } from "@/lib/logger";

/** The identity stamped on every outgoing notify event. */
export interface Source {
  sourceId: string;
  /** Raw `Zotero.Profile.dir`, included only when debug logging is on. */
  profilePath?: string;
  /** Raw `Zotero.DataDirectory.dir`, included only when debug logging is on. */
  dataPath?: string;
}

interface Cached {
  profileDir: string;
  dataDir: string;
  sourceId: string;
}

let cached: Cached | undefined;

/**
 * Profile/data dirs and their hashed source id, computed once — all three are
 * fixed for the lifetime of the process. `Zotero.File.pathToFileURI` is
 * `Services.io.newFileURI(...).spec`, the Gecko counterpart to Node's
 * `pathToFileURL` used on the Obsidian side.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/file.js#L59-L62
 */
function resolve(): Cached {
  if (!cached) {
    const profileDir = Zotero.Profile.dir;
    const dataDir = Zotero.DataDirectory.dir;
    cached = {
      profileDir,
      dataDir,
      sourceId: sourceIdFromUris(
        Zotero.File.pathToFileURI(profileDir),
        Zotero.File.pathToFileURI(dataDir),
      ),
    };
  }
  return cached;
}

/**
 * The {@link Source} to stamp on every event: the source id plus, when debug
 * logging is on, the raw profile/data dirs so the listener can log which
 * install a discarded event came from.
 */
export function currentSource(): Source {
  const { profileDir, dataDir, sourceId } = resolve();
  if (!logger.isEnabledFor("debug")) return { sourceId };
  return { sourceId, profilePath: profileDir, dataPath: dataDir };
}
