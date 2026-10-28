// What choosing a quick switcher result does, by its key: open the Item's
// Literature Note, or write it, and open the Item's PDF. A Library View row
// answers the same keys through the same functions (ADR 0074).
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { Cause, Effect, Exit } from "effect";
import type { PaneType } from "obsidian";

import type { Item } from "@zotlit/db";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import {
  openGesture,
  pdfPickerReader,
} from "@/services/attachment-open/actions";
import type { AttachmentOpenDeps } from "@/services/attachment-open/actions";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import { openLiteratureNote } from "@/services/note-feature/navigation";

export interface NoteResultDeps {
  registry: ViewRegistryHandle;
  creation: InteractiveCreationPorts;
}

/** Run the shared note navigation from the Quick Switch modal callback. */
export function openOrCreateNote(
  deps: NoteResultDeps,
  options: { indexedKey: string; item: Item; newPane: PaneType | boolean },
): Promise<void> {
  const result = Promise.withResolvers<void>();
  const command = viewRuntime.fn((_input: void) =>
    openLiteratureNote(deps.creation, options.indexedKey, {
      source: "interactive",
      item: options.item,
      paneType: options.newPane,
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            result.reject(Cause.squash(exit.cause));
          else result.resolve();
        }),
      ),
    ),
  );
  const release = deps.registry.mount(command);
  deps.registry.set(command, undefined);
  return result.promise.finally(release);
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
  const attachments =
    await deps.attachments.literatureNoteAttachments(indexedKey);
  if (!attachments) return;
  openAttachments(attachments, {
    reader: withFixedPane(
      pdfPickerReader(openGesture(deps.opener, deps.bridge.runAndForget)),
      pane,
    ),
    app: deps.app,
  });
}
