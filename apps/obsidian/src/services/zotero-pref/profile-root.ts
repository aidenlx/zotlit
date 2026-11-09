import { Effect, FileSystem } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";

import { requireElectronRemote } from "@/lib/require";

/**
 * Platform directory that holds `profiles.ini`. Relative
 * `Path=` entries in `profiles.ini` are resolved against it.
 *
 * Zotero sets both vendor and application name to `Zotero`. Gecko appends
 * both on Windows, only the application on macOS, and lowercase names on
 * Linux. Electron supplies the corresponding OS application-data base.
 *
 * @see https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_1_0esr_RELEASE/toolkit/xre/nsXREDirProvider.cpp
 */
function profilePaths(): { root: string; legacyRoot?: string } {
  switch (process.platform) {
    case "win32":
      return {
        root: join(
          requireElectronRemote().app.getPath("appData"),
          "Zotero",
          "Zotero",
        ),
      };
    case "darwin":
      return {
        root: join(requireElectronRemote().app.getPath("appData"), "Zotero"),
      };
    default: {
      const legacyRoot = join(homedir(), ".zotero", "zotero");
      if (process.env.MOZ_LEGACY_HOME?.startsWith("1"))
        return { root: legacyRoot };
      return {
        root: join(
          requireElectronRemote().app.getPath("appData"),
          "zotero",
          "zotero",
        ),
        legacyRoot,
      };
    }
  }
}

/** Resolve the profiles root without blocking the renderer on filesystem I/O. */
export const zoteroProfilesRoot = Effect.gen(function* () {
  const { root, legacyRoot } = yield* Effect.sync(profilePaths);
  if (legacyRoot) {
    const fs = yield* FileSystem.FileSystem;
    // Directory presence selects Gecko's legacy layout, even before an INI exists.
    if (yield* fs.exists(legacyRoot)) return legacyRoot;
  }
  return root;
}).pipe(Effect.withSpan("ZoteroPref.profilesRoot"));
