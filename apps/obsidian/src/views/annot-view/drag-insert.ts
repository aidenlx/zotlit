import { type Workspace } from "obsidian";
import { type DragEvent } from "react";

import { type AnnotViewItem } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { type AttachmentImport } from "@/services/attachment-import/service";
import { type NoteFeature } from "@/services/note-feature";

const logger = getLogger(["views", "annot-view"]);

/** Custom drag MIME type tagging a drag that originated from the annot view. */
const SOURCE_TAG = "zotlit-annot-drag";

export interface DragInsertDeps {
  workspace: Workspace;
  noteFeature: Pick<NoteFeature, "renderAnnotation">;
  /** Pre-prepared attachment-import handle for the active note. */
  getImportHandle: () => AttachmentImport | null;
  /**
   * Called once a drag settles (dropped or abandoned) so the view can swap in a
   * fresh handle — discarding an abandoned drag's pending image (v1's `cancel`).
   */
  onSettled: () => void;
}

/**
 * Build the annot-view `onDragStart` handler. On drag start it renders the
 * dragged annotation through the `annotation` template into the `text/plain`
 * payload (Obsidian inserts it natively on drop) and, when the drop lands in an
 * editor, flushes the annotation's image excerpt into the vault — mirroring v1's
 * templated drag-insert.
 */
export function createDragInsertHandler(deps: DragInsertDeps) {
  return (evt: DragEvent<HTMLElement>, annot: AnnotViewItem): void => {
    const handle = deps.getImportHandle();

    const rendered = handle
      ? deps.noteFeature.renderAnnotation(annot.itemID, {
          attachmentImport: handle,
        })
      : null;

    evt.dataTransfer.dropEffect = "copy";

    if (rendered == null || handle == null) {
      // Fallback: plain text when the template/import isn't ready.
      evt.dataTransfer.setData("text/plain", annot.text ?? annot.key);
      return;
    }

    const timestamp = String(evt.timeStamp);
    evt.dataTransfer.setData("text/plain", rendered);
    evt.dataTransfer.setData(SOURCE_TAG, timestamp);

    const { workspace } = deps;
    const win = (evt.target as HTMLElement).win;

    const cleanup = () => {
      workspace.offref(dropRef);
      win.removeEventListener("dragend", onDragEnd);
      deps.onSettled();
    };
    const dropRef = workspace.on("editor-drop", (dropEvt) => {
      if (dropEvt.dataTransfer?.getData(SOURCE_TAG) === timestamp) {
        void handle.flush().catch((error) => {
          logger.warn("Failed to import dragged annotation image", { error });
        });
      }
      cleanup();
    });
    win.addEventListener("dragend", onDragEnd, { once: true });
    function onDragEnd(): void {
      cleanup();
    }
  };
}
