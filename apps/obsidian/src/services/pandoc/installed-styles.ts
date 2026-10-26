// The CSL styles Zotero installed, as Effect code over the FileSystem service.
// Discovery reads the same files the Promise reader in `./styles` reads, and
// each caller chooses what to show where a folder refuses to be listed.

import { Effect, FileSystem } from "effect";
import type { PlatformError } from "effect";
import { join } from "node:path";

import { withLogCategory } from "@/lib/effect-log-category";

import {
  CSL_EXT,
  HIDDEN_DIR,
  selectableStyles,
  STYLES_DIR,
  styleFileOf,
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
      yield* listStyleDir(root),
      yield* listStyleDir(join(root, HIDDEN_DIR)),
    );
  },
  withLogCategory("pandoc", "styles"),
);

/** The styles one folder holds; a folder that is absent holds none. */
const listStyleDir = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs
    .readDirectory(dir)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed<string[]>([]),
      ),
    );
  const files = yield* Effect.forEach(
    names.filter((name) => name.endsWith(CSL_EXT)),
    (name) => {
      const path = join(dir, name);
      return fs.readFileString(path).pipe(
        Effect.map((xml) => styleFileOf(path, xml)),
        Effect.catchTag("PlatformError", (error) =>
          Effect.as(
            Effect.logWarning("Cannot read a CSL style file", path, error),
            undefined,
          ),
        ),
      );
    },
    { concurrency: "unbounded" },
  );
  return files.filter((file) => file !== undefined);
});
