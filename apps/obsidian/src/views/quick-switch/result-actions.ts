// What choosing a quick switcher result does, by its key: open the Item's
// Literature Note, or write it, and open the Item's PDF. A Library View row
// answers the same keys through the same functions (ADR 0074).
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { MarkdownView } from "obsidian";
import type { App, PaneType, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import {
  pdfPickerReader,
  resolveLiteratureNoteAttachments,
} from "@/services/attachment-open/actions";
import type { AttachmentOpenDeps } from "@/services/attachment-open/actions";
import { createNoteInteractively } from "@/services/note-feature";
import type { InteractiveCreationDeps } from "@/services/note-feature/creation-view";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";
import type { PlainNoteIndex } from "@/services/note-index/plain";

export interface NoteResultDeps extends InteractiveCreationDeps {
  noteIndex: Pick<PlainNoteIndex, "whenIndexed" | "getNotesByItemKey">;
}

/**
 * Open the Literature Note of the Item `indexedKey`; where it has none,
 * write one through the Profile selection and open it. `item` reads the Item
 * the note is written from, only where one is written.
 */
export async function openOrCreateNote(
  deps: NoteResultDeps,
  {
    indexedKey,
    item,
    newPane,
  }: {
    indexedKey: string;
    item: () => Promise<Item | null | undefined>;
    newPane: PaneType | boolean;
  },
): Promise<void> {
  await deps.noteIndex.whenIndexed();
  const existing = resolveLiteratureNoteWithWarning(
    deps.noteIndex.getNotesByItemKey(indexedKey),
  );
  if (existing) {
    await openNote(deps.app, existing, newPane);
    return;
  }
  const found = await item();
  if (!found) return;
  await openNote(deps.app, await createNoteInteractively(deps, found), newPane);
}

/**
 * Open `file`: in a new pane, or where a tab already shows it, else in the
 * current one.
 */
async function openNote(
  app: App,
  file: TFile | null | undefined,
  newPane: PaneType | boolean,
): Promise<void> {
  if (!file) return;
  const { workspace } = app;
  if (!newPane) {
    const existing = workspace
      .getLeavesOfType("markdown")
      .find(
        (leaf) => leaf.view instanceof MarkdownView && leaf.view.file === file,
      );
    if (existing) {
      await workspace.revealLeaf(existing);
      workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
  }
  await workspace.openLinkText(file.path, "", newPane, { active: true });
}

/**
 * Open the PDF of the Item `indexedKey` in Obsidian, in `pane`. The search
 * index holds regular Items only, so the Item's Attachments are resolved
 * through the database, as the `open-pdf` command does. No pointer event
 * reaches `openAttachments` — a key carries no pointer to anchor a context
 * menu at — so several Attachments always fall to the Suggest modal picker.
 */
export async function openItemPdf(
  deps: AttachmentOpenDeps,
  indexedKey: string,
  pane: PaneType | boolean,
): Promise<void> {
  const attachments = await resolveLiteratureNoteAttachments(deps, indexedKey);
  openAttachments(attachments, {
    reader: withFixedPane(pdfPickerReader(deps.opener), pane),
    app: deps.app,
  });
}
