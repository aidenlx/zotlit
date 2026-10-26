// UI seam for note-import: opens the batch modal and the overwrite confirm against the running app.
import type { Effect } from "effect";
import type { App } from "obsidian";

import { awaitConfirm } from "@/lib/confirm";
import type { ConfirmOptions } from "@/lib/confirm";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { chooseBatchProfile } from "@/services/batch-profile-choice";
import type {
  BatchProfilePickerDeps,
  BatchProfilePickerOptions,
} from "@/services/batch-profile-choice";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import { BatchModal } from "@/views/batch-modal";
import type { BatchModalOptions } from "@/views/batch-modal";

/**
 * The view capabilities the batch-import runners drive. Bundling them keeps the
 * concrete modal classes and the `App` handle out of the runners' service deps,
 * so the runners depend on this narrow UI port instead.
 */
export interface NoteImportView {
  openBatchModal(options: BatchModalOptions): void;
  /** The user's answer; an interrupt closes the modal. */
  confirm(options: ConfirmOptions): Effect.Effect<boolean>;
  /** The user's Profile, or `undefined`; an interrupt closes the picker. */
  chooseProfile(
    options: BatchProfilePickerOptions,
  ): Effect.Effect<ProfileSelector | undefined, never, ZoteroPref>;
}

export function createNoteImportView(
  app: App,
  profilePicker: Omit<BatchProfilePickerDeps, "app">,
): NoteImportView {
  return {
    openBatchModal: (options) => new BatchModal(app, options).open(),
    confirm: (options) => awaitConfirm(options, app),
    chooseProfile: (options) =>
      chooseBatchProfile({ app, ...profilePicker }, options),
  };
}
