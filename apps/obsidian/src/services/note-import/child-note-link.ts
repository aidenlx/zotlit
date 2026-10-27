// A Child Note's link in a Literature Note's template: its Imported Note, or Zotero.
import type { TFile } from "obsidian";

import type { ChildNote, TemplateNoteLink } from "@zotlit/db";
import { zoteroNoteLink } from "@zotlit/db";

import type { MarkdownLinker } from "@/lib/obsidian-file-manager";

/** What a Child Note's link reads: its Imported Note, and the link call. */
export interface ChildNoteLinkDeps {
  /** The Imported Note of the Child Note `noteKey` names, if one exists. */
  importedNote: (noteKey: string) => TFile | undefined;
  /** The link to `file` from the note at `sourcePath`, in the user's link format. */
  link: MarkdownLinker;
}

/**
 * A Child Note's link-only template shape. Its `noteLink` links the Child
 * Note's Imported Note when one exists (matched by identity, not path) and
 * otherwise opens the note in Zotero. Rendering it reads the note index and
 * writes nothing: a Child Note becomes a file only through an import command.
 * The default alias is the live note title, so a retitled Zotero note updates
 * the link text without renaming the file.
 */
export function childNoteLink(
  deps: ChildNoteLinkDeps,
  note: ChildNote,
  sourcePath: string,
): TemplateNoteLink {
  return {
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: (alias, subpath) => {
      const imported = deps.importedNote(note.indexedKey);
      if (imported)
        return deps.link(imported, sourcePath, {
          subpath,
          alias: alias ?? note.title ?? undefined,
        });
      return zoteroNoteLink(note, alias);
    },
  };
}
