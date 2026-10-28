// Asynchronous annotation insertion for the menu action and ZotLit-owned drops.
import { nanoid } from "nanoid";
import { MarkdownView } from "obsidian";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import type { DragEvent } from "react";

import * as m from "@/lib/i18n/generated/messages";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import { onFiberSuccess } from "@/lib/view-runner";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type {
  AnnotationInsertOutcome,
  AnnotationSnapshot,
} from "@/services/note-feature/insert-action";
export type { AnnotationInsertOutcome } from "@/services/note-feature/insert-action";

import { captureInsertion } from "./async-insert";
import { startInsert } from "./insert-run";
import type { InsertFiber, InsertRunner } from "./insert-run";

const SOURCE_TAG = "application/x-zotlit-annotation";

/** What an insert needs; `R` is the services its Effects run with. */
export interface InsertDeps<R> extends InsertRunner<R> {
  app: App;
  snapshot: (annotation: AnnotationRecord) => AnnotationSnapshot;
  notify: (message: string | DocumentFragment) => void;
}

/** The function that shows the notice of an outcome. */
const reporter =
  (deps: Pick<InsertDeps<never>, "app" | "notify">) =>
  (outcome: AnnotationInsertOutcome): void => {
    const message = insertOutcomeMessage(deps.app, outcome);
    if (message !== null) deps.notify(message);
  };

/**
 * The one insert a handler has in flight: holding a newer one interrupts it.
 * The outcome of an insert that finishes is shown; an interrupted one shows
 * nothing.
 */
function insertSlot(report: (outcome: AnnotationInsertOutcome) => void) {
  let pending: InsertFiber | null = null;
  const cancel = () => pending?.interruptUnsafe();
  return {
    cancel,
    hold(fiber: InsertFiber): InsertFiber {
      cancel();
      pending = fiber;
      fiber.addObserver(() => {
        if (pending === fiber) pending = null;
      });
      onFiberSuccess(fiber, report);
      return fiber;
    },
  };
}

/**
 * The notice for an insert's outcome, or `null` for none: an Excerpt Image
 * summary where an image is not refreshed, a Profile error by its own
 * message, and a failure as the generic message.
 */
export function insertOutcomeMessage(
  app: App,
  outcome: AnnotationInsertOutcome,
): string | DocumentFragment | null {
  switch (outcome.kind) {
    case "unavailable":
      return m.annotation_suggest_unavailable();
    case "no-note":
      return m.annot_view_insert_no_note();
    case "source-unavailable":
      return m.annot_view_drag_unavailable();
    case "fallback":
      return outcome.landed ? m.annot_view_drag_unavailable() : null;
    case "inserted": {
      const { summary } = outcome;
      return summary.zotero || summary.unchecked || summary.unavailable
        ? m.excerpt_image_summary({
            ...summary,
            notRefreshed: summary.notRefreshed ?? 0,
          })
        : null;
    }
    case "profile-error": {
      const { diagnostic, message } = outcome.error;
      return diagnostic.code === "unknown-literature-note-profile"
        ? profileRecoveryNotice(app, diagnostic)
        : message;
    }
    case "failed":
      return m.annot_view_insert_failed();
    case "cancelled":
      return null;
  }
}

/**
 * Sidebar focus leaves the most recently used note and its cursor in place. A
 * note in Reading view shows no editor, so nothing is inserted into it.
 */
export function getInsertionEditor(app: App): MarkdownFileInfo | null {
  const active = app.workspace.activeEditor;
  if (active instanceof MarkdownView && active.getMode() !== "source")
    return null;
  if (active) return active;
  const view = app.workspace.getMostRecentLeaf()?.view;
  return view instanceof MarkdownView && view.getMode() === "source"
    ? view
    : null;
}

export function createInsertHandler<R>(deps: InsertDeps<R>) {
  const report = reporter(deps);
  const slot = insertSlot(report);
  const { cancel } = slot;
  /** The insert in flight, or `null` where it ended at once with its notice. */
  const insertInto = (
    annotation: AnnotationRecord,
    info: MarkdownFileInfo | null,
  ): InsertFiber | null => {
    cancel();
    const editor = info?.editor;
    const file = info?.file;
    if (!info || !file || !editor) {
      report({ kind: "no-note" });
      return null;
    }
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
      report({ kind: "source-unavailable" });
      return null;
    }
    return slot.hold(
      startInsert(deps, {
        annotation,
        snapshot,
        notePath: file.path,
        capture: () =>
          captureInsertion({
            editor,
            info,
            isCurrent: () => {
              const current = getInsertionEditor(deps.app);
              return current?.editor === editor && current.file === info.file;
            },
            workspace: deps.app.workspace,
          }),
      }),
    );
  };
  const offer = () => {
    const info = getInsertionEditor(deps.app);
    const file = info?.file;
    const editor = info?.editor;
    if (!info || !file || !editor) return null;
    return (annotation: AnnotationRecord) => {
      const current = getInsertionEditor(deps.app);
      if (
        current?.file !== file ||
        current.editor !== editor ||
        info.file !== file ||
        info.editor !== editor
      )
        return null;
      return insertInto(annotation, info);
    };
  };
  const insert = (annotation: AnnotationRecord) =>
    insertInto(annotation, getInsertionEditor(deps.app));
  return Object.assign(insert, { cancel, offer });
}

interface ActiveDrag {
  cancel(): void;
}

export function createDragInsertHandler<R>(deps: InsertDeps<R>) {
  const report = reporter(deps);
  const slot = insertSlot(report);
  let active: ActiveDrag | null = null;
  const cancel = () => {
    active?.cancel();
    slot.cancel();
  };
  const drag = (
    event: DragEvent<HTMLElement>,
    annotation: AnnotationRecord,
  ): void => {
    cancel();
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
      event.preventDefault();
      report({ kind: "source-unavailable" });
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
      if (!info.file) {
        report({ kind: "no-note" });
        return;
      }
      slot.hold(
        insertDrop(deps, {
          annotation,
          snapshot,
          dropEvent,
          editor,
          info,
          file: info.file,
        }),
      );
    });
    active = operation;
    win.addEventListener("dragend", onDragEnd, { once: true });
  };
  return Object.assign(drag, { cancel });
}

function insertDrop<R>(
  deps: InsertDeps<R>,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    // eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
    dropEvent: globalThis.DragEvent;
    editor: Editor;
    info: MarkdownFileInfo;
    file: TFile;
  },
): InsertFiber {
  const { editor, info, file } = options;
  // The nearest position, as CodeMirror's own drop handler asks for: the
  // exact form is null over an empty active line.
  const position = editor.cm.posAtCoords(
    { x: options.dropEvent.clientX, y: options.dropEvent.clientY },
    false,
  );
  return startInsert(deps, {
    annotation: options.annotation,
    snapshot: options.snapshot,
    notePath: file.path,
    capture: () =>
      captureInsertion({
        editor,
        info,
        range: { from: position, to: position },
        isCurrent: () => info.file === file && info.editor === editor,
        workspace: deps.app.workspace,
      }),
  });
}
