// View atoms over the active note: which file is active and the Zotero key
// its frontmatter names. Read through `@/lib/view-atoms`.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { held } from "@/lib/view-atoms";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

/** The active file's path, and the key of the Item it is a note of. */
export interface ActiveNote {
  readonly path: string | null;
  readonly key: string | null;
}

const NO_NOTE: ActiveNote = { path: null, key: null };

const sameNote = (a: ActiveNote, b: ActiveNote) =>
  a.path === b.path && a.key === b.key;

/**
 * The active note now and on each change: another leaf or file opens, the
 * active file's frontmatter changes, it moves, or it is deleted. Emits when
 * the path or the key changes.
 */
export const activeNote: Stream.Stream<
  ActiveNote,
  never,
  MetadataCache | Vault | Workspace
> = Stream.unwrap(
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const vault = yield* Vault;
    const read = Effect.gen(function* () {
      const file = yield* workspace.getActiveFile;
      const cache =
        file?.extension === "md" ? yield* metadata.fileCache(file) : null;
      return { path: file?.path ?? null, key: itemKeyFromFrontmatter(cache) };
    });
    // A deleted active file is still the active file until its leaf closes.
    const onDelete = Stream.mapEffect(
      filterTag(vault.changes, "delete"),
      (event) =>
        Effect.map(workspace.getActiveFile, (active) =>
          active === event.file ? Effect.succeed(NO_NOTE) : read,
        ),
    );
    const reads = Stream.mergeAll(
      [
        Stream.make(read),
        Stream.map(
          filterTag(workspace.changes, "file-open", "active-leaf-change"),
          () => read,
        ),
        Stream.map(filterTag(metadata.changes, "changed"), () => read),
        Stream.map(filterTag(vault.changes, "rename"), () => read),
        onDelete,
      ],
      { concurrency: "unbounded" },
    );
    return reads.pipe(
      Stream.mapEffect((next) => next),
      Stream.changesWith(sameNote),
    );
  }),
);

/** The active note; no note until the first read. */
export const activeNoteAtom: Atom.Atom<ActiveNote> = held(activeNote, NO_NOTE);

/** The active note's key. An equal key stops here, so a rename reads nothing new below. */
export const activeKeyAtom: Atom.Atom<string | null> = Atom.map(
  activeNoteAtom,
  (note) => note.key,
);
