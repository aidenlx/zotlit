import type { App } from "obsidian";
import type { DragEvent } from "react";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type { AttachmentImport } from "@/services/attachment-import/service";
import type { NoteFeature } from "@/services/note-feature";
import { ProfileAnnotationError } from "@/services/template/service";

import { captureInsertion } from "./async-insert";

const logger = getLogger(["views", "annot-view"]);

/** Custom drag MIME type tagging a drag that originated from the annot view. */
const SOURCE_TAG = "zotlit-annot-drag";

export interface DragInsertDeps {
  app: App;
  noteFeature: Pick<NoteFeature, "renderAnnotation">;
  notify: (message: string | DocumentFragment) => void;
  /** Pre-prepared attachment-import handle for the active note. */
  getImportHandle: () => AttachmentImport | null;
  /**
   * The numeric id the Zotero database holds for an Annotation, or `null` for
   * one it does not hold yet. The annotation template renders from the
   * database, so a card the Zotero Local API answered before SQLite caught up
   * cannot be rendered — the drag says so rather than inserting nothing.
   */
  resolveAnnotationID: (indexedKey: string) => number | null;
  /**
   * Called once a drag settles (dropped or abandoned) so the view can swap in a
   * fresh handle — discarding an abandoned drag's pending image (v1's `cancel`).
   */
  onSettled: () => void;
}

/**
 * What a render of one Annotation answered.
 *
 * `fallback` and `unavailable` have both already told the user why, so a caller
 * chooses what to do with the text and says nothing more.
 */
type AnnotationRender =
  /** The Annotation through its template, with the handle its excerpt rode in. */
  | { kind: "rendered"; text: string; handle: AttachmentImport }
  /** The Annotation's own text, where its Profile could not be read. */
  | { kind: "fallback"; text: string }
  /** Nothing to insert. */
  | { kind: "unavailable" };

/**
 * Render one Annotation through the `annotation` template, raising the notice
 * that names the reason where it cannot run. Shared by the drag and by the
 * overflow menu's insert, so both put the same Markdown into a note.
 */
function renderAnnotation(
  deps: DragInsertDeps,
  annot: AnnotationRecord,
): AnnotationRender {
  const annotationID = deps.resolveAnnotationID(annot.key);
  if (annotationID === null) {
    new BaseNotice(m.annot_view_annotation_not_in_database());
    return { kind: "unavailable" };
  }

  const handle = deps.getImportHandle();
  let rendered: string | null = null;
  try {
    rendered = handle
      ? deps.noteFeature.renderAnnotation(annotationID, {
          attachmentImport: handle,
        })
      : null;
  } catch (error) {
    if (!(error instanceof ProfileAnnotationError)) throw error;
    deps.notify(
      error.diagnostic.code === "unknown-literature-note-profile"
        ? profileRecoveryNotice(deps.app, error.diagnostic)
        : error.message,
    );
    return { kind: "fallback", text: annot.text ?? annot.key };
  }

  if (rendered == null || handle == null) {
    logger.warn("Annotation insert cancelled", {
      annotationKey: annot.key,
      reason: handle == null ? "no-import-handle" : "render-unavailable",
    });
    new BaseNotice(m.annot_view_drag_unavailable());
    return { kind: "unavailable" };
  }
  return { kind: "rendered", text: rendered, handle };
}

/**
 * Put one Annotation into the note at its cursor — the same Markdown a drag
 * drops, reached from the card's overflow menu. The menu is what a keyboard
 * reaches, so a pointer is no longer the only thing that carries an Annotation
 * into a note.
 */
export function createInsertHandler(deps: {
  app: App;
  noteFeature: Pick<NoteFeature, "prepareAnnotationInsert">;
  snapshot: (annotation: AnnotationRecord) => {
    source: AnnotationSource | null;
    sourceScope: string | null;
  };
  notify: (message: string | DocumentFragment) => void;
}) {
  let pending: ReturnType<typeof captureInsertion> | null = null;
  const cancel = () => pending?.cancel();
  const insert = async (annot: AnnotationRecord): Promise<void> => {
    cancel();
    const { workspace } = deps.app;
    const info = workspace.activeEditor;
    const editor = info?.editor;
    if (!info?.file || !editor) {
      deps.notify(m.annot_view_insert_no_note());
      return;
    }
    const { source, sourceScope } = deps.snapshot(annot);
    if (!source || sourceScope === null) {
      deps.notify(m.annot_view_drag_unavailable());
      return;
    }
    using target = captureInsertion({
      editor,
      info,
      isCurrent: () =>
        workspace.activeEditor?.editor === editor &&
        workspace.activeEditor.file === info.file,
    });
    pending = target;
    const changed = workspace.on("active-leaf-change", () => {
      if (!target.valid()) target.cancel();
    });
    try {
      const result = await deps.noteFeature.prepareAnnotationInsert({
        annotation: annot,
        source,
        sourceScope,
        notePath: info.file.path,
        signal: target.signal,
        valid: target.valid,
      });
      if (!result && target.valid()) {
        const key = parseIndexedKey(annot.key);
        const parent = parseIndexedKey(annot.parentKey);
        const fallback =
          annot.text ??
          `${m.excerpt_image_unavailable()}${key && parent ? ` [Zotero](${annotationOpenUri({ annotationKey: key.key, attachmentKey: parent.key, groupID: key.groupID, pageLabel: annot.pageLabel })})` : ""}`;
        if (target.commit(fallback))
          deps.notify(m.annot_view_drag_unavailable());
      }
      if (result && target.commit(result.text)) {
        const summary = result.summary;
        if (summary.zotero || summary.unchecked || summary.unavailable)
          deps.notify(
            m.excerpt_image_summary({
              ...summary,
              notRefreshed: summary.notRefreshed ?? 0,
            }),
          );
      }
    } catch (error) {
      if (target.signal.aborted || !target.valid()) return;
      if (error instanceof ProfileAnnotationError) {
        deps.notify(
          error.diagnostic.code === "unknown-literature-note-profile"
            ? profileRecoveryNotice(deps.app, error.diagnostic)
            : error.message,
        );
        target.commit(annot.text ?? annot.key);
      } else {
        logger.warn("Annotation insert failed", {
          annotationKey: annot.key,
          error,
        });
        deps.notify(
          error instanceof Error
            ? error.message
            : m.annot_view_drag_unavailable(),
        );
      }
    } finally {
      workspace.offref(changed);
      if (pending === target) pending = null;
    }
  };
  return Object.assign(insert, { cancel });
}

/**
 * Build the annot-view `onDragStart` handler. On drag start it renders the
 * dragged annotation through the `annotation` template into the `text/plain`
 * payload (Obsidian inserts it natively on drop) and, when the drop lands in an
 * editor, flushes the annotation's image excerpt into the vault — mirroring v1's
 * templated drag-insert.
 *
 * When the render cannot run, the drag is cancelled and a notice says so; the
 * card disables its handle ahead of time via the store's `dragTarget`, so
 * this branch is the last line, not the usual path.
 */
export function createDragInsertHandler(deps: DragInsertDeps) {
  return (evt: DragEvent<HTMLElement>, annot: AnnotationRecord): void => {
    evt.dataTransfer.dropEffect = "copy";

    const render = renderAnnotation(deps, annot);
    if (render.kind === "unavailable") {
      evt.preventDefault();
      return;
    }
    if (render.kind === "fallback") {
      evt.dataTransfer.setData("text/plain", render.text);
      deps.onSettled();
      return;
    }
    const { handle } = render;

    const timestamp = String(evt.timeStamp);
    evt.dataTransfer.setData("text/plain", render.text);
    evt.dataTransfer.setData(SOURCE_TAG, timestamp);

    const { workspace } = deps.app;
    const win = (evt.target as HTMLElement).win;

    const cleanup = () => {
      workspace.offref(dropRef);
      win.removeEventListener("dragend", onDragEnd);
      deps.onSettled();
    };
    // Side-effect listener only (flushes the pending attachment import); the
    // actual insertion is Obsidian's native `text/plain` drop handling above,
    // so calling `preventDefault()` here would break it.
    // eslint-disable-next-line obsidianmd/editor-drop-paste
    const dropRef = workspace.on("editor-drop", (dropEvt) => {
      if (dropEvt.dataTransfer?.getData(SOURCE_TAG) === timestamp) {
        void handle.flush().catch((error) => {
          logger.warn("Failed to import dragged annotation image", { error });
        });
      }
      cleanup();
    });
    // Reached only when no editor drop ran (the drop path detaches this
    // listener), so the excerpt this render queued must not ride along with
    // the next drop's flush.
    const onDragEnd = (): void => {
      handle.discard();
      cleanup();
    };
    win.addEventListener("dragend", onDragEnd, { once: true });
  };
}
