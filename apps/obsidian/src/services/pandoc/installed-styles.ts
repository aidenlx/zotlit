// The CSL styles Zotero installed, as Effect code over the FileSystem service.
// Each caller chooses what to show where a folder refuses to be listed.

import { Effect } from "effect";
import type { FileSystem, PlatformError } from "effect";
import { join } from "node:path";

import { withLogCategory } from "@/lib/effect-log-category";

import {
  HIDDEN_DIR,
  readStyleDir,
  readStyleDirOrEmpty,
  selectableStyles,
  STYLES_DIR,
} from "./styles";
import type { InstalledCslStyle } from "./styles";

/**
 * The styles a user can select, sorted by title. A styles folder that is
 * absent holds no style. A folder that refuses to be listed fails the read.
 * A CSL file that refuses to be read is skipped, as one that declares no
 * style ID is.
 */
export const listInstalledStyles = Effect.fn("CslStyles.listInstalled")(
  function* (
    dataDir: string,
  ): Effect.fn.Return<
    InstalledCslStyle[],
    PlatformError.PlatformError,
    FileSystem.FileSystem
  > {
    const root = join(dataDir, STYLES_DIR);
    return selectableStyles(
      (yield* readStyleDir(root)).files,
      (yield* readStyleDir(join(root, HIDDEN_DIR))).files,
    );
  },
  withLogCategory("pandoc", "styles"),
);
/** Dialogs retain the readable styles when either directory refuses to be listed. */
export const listInstalledStylesOrNone = Effect.fn("CslStyles.listReadable")(
  function* (dataDir: string) {
    const root = join(dataDir, STYLES_DIR);
    return selectableStyles(
      (yield* readStyleDirOrEmpty(root)).files,
      (yield* readStyleDirOrEmpty(join(root, HIDDEN_DIR))).files,
    );
  },
  withLogCategory("pandoc", "styles"),
);
