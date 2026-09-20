// Asynchronous annotation insertion for the menu action and ZotLit-owned drops.
import { nanoid } from "nanoid";
import type { App, Editor, MarkdownFileInfo } from "obsidian";
import type { DragEvent } from "react";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type { NoteFeature } from "@/services/note-feature";
import { ProfileAnnotationError } from "@/services/template/service";

import { captureInsertion } from "./async-insert";

const logger = getLogger(["views", "annot-view"]);
const SOURCE_TAG = "application/x-zotlit-annotation";

interface AnnotationSnapshot {
  source: AnnotationSource | null;
  sourceScope: string | null;
}

interface AsyncInsertDeps {
  app: App;
  noteFeature: Pick<NoteFeature, "prepareAnnotationInsert">;
  snapshot: (annotation: AnnotationRecord) => AnnotationSnapshot;
  notify: (message: string | DocumentFragment) => void;
}

type InsertionTarget = ReturnType<typeof captureInsertion>;

function fallbackText(annotation: AnnotationRecord): string {
  const key = parseIndexedKey(annotation.key);
  const parent = parseIndexedKey(annotation.parentKey);
  return (
    annotation.text ??
    `${m.excerpt_image_unavailable()}${key && parent ? ` [Zotero](${annotationOpenUri({ annotationKey: key.key, attachmentKey: parent.key, groupID: key.groupID, pageLabel: annotation.pageLabel })})` : ""}`
  );
}

async function prepareAndCommit(
  deps: AsyncInsertDeps,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    target: InsertionTarget;
    notePath: string;
  },
): Promise<void> {
  const { annotation, snapshot, target, notePath } = options;
  try {
    const result = await deps.noteFeature.prepareAnnotationInsert({
      annotation,
      source: snapshot.source!,
      sourceScope: snapshot.sourceScope!,
      notePath,
      signal: target.signal,
      valid: target.valid,
    });
    if (!result && target.valid()) {
      if (target.commit(fallbackText(annotation)))
        deps.notify(m.annot_view_drag_unavailable());
      return;
    }
    if (!result || !target.commit(result.text)) return;
    const { summary } = result;
    if (summary.zotero || summary.unchecked || summary.unavailable)
      deps.notify(
        m.excerpt_image_summary({
          ...summary,
          notRefreshed: summary.notRefreshed ?? 0,
        }),
      );
  } catch (error) {
    if (target.signal.aborted || !target.valid()) return;
    if (error instanceof ProfileAnnotationError) {
      deps.notify(
        error.diagnostic.code === "unknown-literature-note-profile"
          ? profileRecoveryNotice(deps.app, error.diagnostic)
          : error.message,
      );
      target.commit(annotation.text ?? annotation.key);
      return;
    }
    logger.warn("Annotation insert failed", {
      annotationKey: annotation.key,
      error,
    });
    deps.notify(
      error instanceof Error ? error.message : m.annot_view_drag_unavailable(),
    );
  }
}

export function createInsertHandler(deps: AsyncInsertDeps) {
  let pending: InsertionTarget | null = null;
  const cancel = () => pending?.cancel();
  const insert = async (annotation: AnnotationRecord): Promise<void> => {
    cancel();
    const { workspace } = deps.app;
    const info = workspace.activeEditor;
    const editor = info?.editor;
    if (!info?.file || !editor) {
      deps.notify(m.annot_view_insert_no_note());
      return;
    }
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
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
      await prepareAndCommit(deps, {
        annotation,
        snapshot,
        target,
        notePath: info.file.path,
      });
    } finally {
      workspace.offref(changed);
      if (pending === target) pending = null;
    }
  };
  return Object.assign(insert, { cancel });
}

interface ActiveDrag {
  cancel(): void;
}

export function createDragInsertHandler(deps: AsyncInsertDeps) {
  let active: ActiveDrag | null = null;
  let pending: InsertionTarget | null = null;
  const cancel = () => {
    active?.cancel();
    pending?.cancel();
  };
  const drag = (
    event: DragEvent<HTMLElement>,
    annotation: AnnotationRecord,
  ): void => {
    cancel();
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
      event.preventDefault();
      deps.notify(m.annot_view_drag_unavailable());
      return;
    }

    const request = nanoid();
    event.dataTransfer.dropEffect = "copy";
    event.dataTransfer.setData("text/plain", annotation.text ?? annotation.key);
    event.dataTransfer.setData(SOURCE_TAG, request);

    const { workspace } = deps.app;
    const win = event.currentTarget.win;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      workspace.offref(dropRef);
      win.removeEventListener("dragend", onDragEnd);
      if (active === operation) active = null;
    };
    const operation: ActiveDrag = { cancel: cleanup };
    const onDragEnd = () => cleanup();
    // eslint-disable-next-line obsidianmd/editor-drop-paste
    const dropRef = workspace.on("editor-drop", (dropEvent, editor, info) => {
      if (dropEvent.dataTransfer?.getData(SOURCE_TAG) !== request) return;
      dropEvent.preventDefault();
      dropEvent.dataTransfer.dropEffect = "copy";
      cleanup();
      void insertDrop(deps, {
        annotation,
        snapshot,
        dropEvent,
        editor,
        info,
        current: (target) => {
          pending?.cancel();
          pending = target;
        },
        settled: (target) => {
          if (pending === target) pending = null;
        },
      });
    });
    active = operation;
    win.addEventListener("dragend", onDragEnd, { once: true });
  };
  return Object.assign(drag, { cancel });
}

async function insertDrop(
  deps: AsyncInsertDeps,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    dropEvent: globalThis.DragEvent;
    editor: Editor;
    info: MarkdownFileInfo;
    current: (target: InsertionTarget) => void;
    settled: (target: InsertionTarget) => void;
  },
): Promise<void> {
  const { editor, info } = options;
  const file = info.file;
  const position = editor.cm.posAtCoords({
    x: options.dropEvent.clientX,
    y: options.dropEvent.clientY,
  });
  if (!file || position === null) {
    deps.notify(m.annot_view_drag_unavailable());
    return;
  }
  using target = captureInsertion({
    editor,
    info,
    range: { from: position, to: position },
    isCurrent: () => info.file === file && info.editor === editor,
  });
  options.current(target);
  const validate = () => {
    if (!target.valid()) target.cancel();
  };
  const activeChanged = deps.app.workspace.on("active-leaf-change", validate);
  const layoutChanged = deps.app.workspace.on("layout-change", validate);
  try {
    await prepareAndCommit(deps, {
      annotation: options.annotation,
      snapshot: options.snapshot,
      target,
      notePath: file.path,
    });
  } finally {
    deps.app.workspace.offref(activeChanged);
    deps.app.workspace.offref(layoutChanged);
    options.settled(target);
  }
}
