// The one place to start a note update: each button answers "which notes?",
// and creating missing notes is an explicit extra choice.
import type { Effect } from "effect";
import { ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";

import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";

/** The Literature Note that is active when the dialog opens. */
export interface ActiveNote {
  file: TFile;
  itemKey: string;
}

export type UpdateNotesChoice =
  | { target: "note"; note: ActiveNote }
  | { target: "all"; create: boolean };

/**
 * Ask which notes to update. The option for the active note appears only with
 * a `note`.
 *
 * @returns the choice, or `null` when the dialog closes. An interrupt closes it.
 */
export function awaitUpdateNotesChoice(
  app: App,
  note?: ActiveNote,
): Effect.Effect<UpdateNotesChoice | null> {
  return awaitModal<UpdateNotesChoice | null>((resolve) => {
    const modal = new ConfirmationModal(app);
    let create = false;
    modal.setTitle(m.modal_update_notes_title());
    modal.setContent(m.modal_update_notes_desc());
    modal.addCheckbox(m.modal_update_notes_create(), (checked) => {
      create = checked;
    });
    if (note)
      modal.addButton((button) => {
        button
          .setButtonText(m.modal_update_notes_active())
          .setCta()
          .onClick(() => resolve({ target: "note", note }));
      });
    modal.addButton((button) => {
      button
        .setButtonText(m.modal_update_notes_all())
        .onClick(() => resolve({ target: "all", create }));
    });
    modal.addCancelButton(m.modal_cancel());
    modal.setCloseCallback(() => resolve(null));
    modal.open();
    return modal;
  });
}
