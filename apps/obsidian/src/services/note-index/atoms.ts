// View atoms over the active note: which file is active and the Zotero key
// its frontmatter names. Read through `@/lib/view-atoms`.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { held } from "@/lib/view-atoms";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import { NoteIndex } from "./service";
import type { NoteIndexChange } from "./service";

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

/** The Item keys that have a Literature Note, now and after each index change. */
export const notedItemKeysAtom = held<ReadonlySet<string>>(
  Stream.unwrap(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return Stream.concat(
        Stream.make(null),
        index.changes.pipe(
          Stream.filter((change) => change.type !== "frontmatter-changed"),
        ),
      ).pipe(
        Stream.mapEffect(() =>
          Effect.map(index.getIndexedItemKeys, (keys) => new Set(keys)),
        ),
      );
    }),
  ),
  new Set<string>(),
);

/** The index facts that table cells and vault conditions read synchronously. */
export interface NoteIndexSnapshot {
  readonly keys: readonly string[];
  readonly names: readonly string[];
  readonly notes: ReadonlyMap<string, readonly TFile[]>;
  readonly paths: Readonly<Record<string, number>>;
  readonly structureRevision: number;
  readonly change: NoteIndexChange | null;
  readonly ready: boolean;
}

const EMPTY_INDEX_SNAPSHOT: NoteIndexSnapshot = {
  keys: [],
  names: [],
  notes: new Map(),
  paths: {},
  structureRevision: 0,
  change: null,
  ready: false,
};

export const noteIndexSnapshotAtom = held<NoteIndexSnapshot>(
  Stream.unwrap(
    Effect.map(NoteIndex, (index) =>
      Stream.concat(Stream.make(null), index.changes).pipe(
        Stream.mapEffect((change) =>
          Effect.gen(function* () {
            const keys = yield* index.getIndexedItemKeys;
            const names = yield* index.getPropertyNames;
            const notes = new Map<string, readonly TFile[]>();
            for (const key of keys)
              notes.set(key, yield* index.getNotesByItemKey(key));
            return { keys, names, notes, change };
          }),
        ),
        Stream.scan(
          () => EMPTY_INDEX_SNAPSHOT,
          (previous, snapshot): NoteIndexSnapshot => ({
            ...snapshot,
            paths:
              snapshot.change && snapshot.change.type !== "indexed"
                ? {
                    ...previous.paths,
                    [snapshot.change.file.path]:
                      (previous.paths[snapshot.change.file.path] ?? 0) + 1,
                  }
                : previous.paths,
            structureRevision:
              previous.structureRevision +
              (snapshot.change && snapshot.change.type !== "frontmatter-changed"
                ? 1
                : 0),
            ready: true,
          }),
        ),
      ),
    ),
  ),
  EMPTY_INDEX_SNAPSHOT,
);

export const noteIndexStructureRevisionAtom = Atom.map(
  noteIndexSnapshotAtom,
  (snapshot) => snapshot.structureRevision,
);
