// The Literature Notes the Table's "Literature note" column shows: the note of
// an Item where the vault has one, and "Create" where it has none. "Create"
// is the usual Literature Note creation, which asks for a Profile when more
// than one fits.
import { Keymap } from "obsidian";
import type { App, TFile } from "obsidian";

import { Effect } from "@/lib/effect";
import { createNoteInteractively } from "@/services/note-feature/creation-view";
import type { InteractiveCreationDeps } from "@/services/note-feature/creation-view";
import type { NoteIndex } from "@/services/note-index/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

/** A Literature Note as the column links it. */
export type LiteratureNoteLink = Pick<TFile, "path" | "basename">;

/** What the "Literature note" column reads and does. */
export interface LiteratureNotes {
  /** The Literature Note of an Item, by its Indexed Key; `null` where it has none. */
  find(itemKey: string): LiteratureNoteLink | null;
  /** A Literature Note was added, changed or removed. */
  on(event: "changed", listener: () => void): () => void;
  /** Open the note; a Cmd/Ctrl press opens it in a new tab. */
  open(note: LiteratureNoteLink, event: MouseEvent): void;
  /** Create the Item's Literature Note, as the usual creation does. */
  create(itemKey: string): Promise<void>;
}

export interface LiteratureNotesDeps extends InteractiveCreationDeps {
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "on">;
  zoteroReads: Pick<ZoteroReadsService, "ready">;
}

/** The column's Literature Notes, from the Note Index and the usual creation. */
export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
  return {
    find: (itemKey) => deps.noteIndex.getNotesByItemKey(itemKey)[0] ?? null,
    on: (event, listener) => deps.noteIndex.on(event, () => listener()),
    open: (note, event) =>
      void deps.app.workspace.openLinkText(
        note.path,
        "",
        Keymap.isModEvent(event),
      ),
    create: async (itemKey) => {
      const { reads } = await deps.zoteroReads.ready;
      const item = (
        await Effect.runPromise(
          reads.ItemsByIndexedKeys({ indexedKeys: [itemKey] }),
        )
      ).get(itemKey);
      if (item) await createNoteInteractively(deps, item);
    },
  };
}
