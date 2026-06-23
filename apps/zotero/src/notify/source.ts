import { sourceIdFromUris } from "@zotlit/protocol";

import { logger } from "@/lib/logger";

/** Raw dirs merged into the notify body, only when debug logging is on. */
export interface DebugDirs {
  /** Raw `Zotero.Profile.dir`. */
  profilePath?: string;
  /** Raw `Zotero.DataDirectory.dir`. */
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

/** The source id sent in the {@link SOURCE_ID_HEADER} header on every push. */
export function sourceId(): string {
  return resolve().sourceId;
}

/**
 * Raw profile/data dirs to merge into the notify body, present only when debug
 * logging is on so the listener can log which install a discarded event came
 * from. Empty otherwise.
 */
export function sourceDebugDirs(): DebugDirs {
  if (!logger.isEnabledFor("debug")) return {};
  const { profileDir, dataDir } = resolve();
  return { profilePath: profileDir, dataPath: dataDir };
}
