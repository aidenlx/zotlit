// The Item bound to a note host, refreshed when that note's metadata changes.
import { Effect, Stream } from "effect";

import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { held } from "@/lib/view-atoms";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

export const makeNoteBindingAtom = (
  sourcePath: () => string,
  initial: string | null,
) =>
  held(
    Stream.unwrap(
      Effect.gen(function* () {
        const metadata = yield* MetadataCache;
        const vault = yield* Vault;
        const read = Effect.gen(function* () {
          const file = yield* vault.getFileByPath(sourcePath());
          return file
            ? itemKeyFromFrontmatter(yield* metadata.fileCache(file))
            : null;
        });
        return Stream.concat(
          Stream.fromEffect(read),
          metadata.changes.pipe(
            Stream.filter(
              (event) =>
                event._tag === "changed" && event.file.path === sourcePath(),
            ),
            Stream.mapEffect(() => read),
          ),
        );
      }),
    ),
    initial,
  );
