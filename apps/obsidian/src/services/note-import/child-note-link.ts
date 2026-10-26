// A Child Note's link in a Literature Note's template: its Imported Note, or Zotero.
import type { FileManager } from "obsidian";

import type { ChildNote, TemplateNoteLink } from "@zotlit/db";
import { zoteroNoteLink } from "@zotlit/db";

import type { PlainNoteIndex } from "@/services/note-index/plain";

/**
 * A Child Note's link-only template shape. Its `noteLink` links the Child
 * Note's Imported Note when one exists (matched by identity, not path) and
 * otherwise opens the note in Zotero. Rendering it reads the note index and
 * writes nothing: a Child Note becomes a file only through an import command.
 * The default alias is the live note title, so a retitled Zotero note updates
 * the link text without renaming the file.
 */
export function childNoteLink(
  deps: {
    app: { fileManager: Pick<FileManager, "generateMarkdownLink"> };
    noteIndex: Pick<PlainNoteIndex, "getImportedNoteByNoteKey">;
  },
  note: ChildNote,
  sourcePath: string,
): TemplateNoteLink {
  return {
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: (alias, subpath) => {
      const imported = deps.noteIndex.getImportedNoteByNoteKey(
        note.indexedKey,
      )[0];
      if (imported)
        return deps.app.fileManager.generateMarkdownLink(
          imported,
          sourcePath,
          subpath,
          alias ?? note.title ?? undefined,
        );
      return zoteroNoteLink(note, alias);
    },
  };
}
