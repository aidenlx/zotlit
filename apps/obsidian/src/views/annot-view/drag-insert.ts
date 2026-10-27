// Asynchronous annotation insertion for the menu action and ZotLit-owned drops.
import { nanoid } from "nanoid";
import { MarkdownView } from "obsidian";
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
import type { NoteFeatureHandle } from "@/services/note-feature";
import { ProfileAnnotationError } from "@/services/template/service";

import { captureInsertion } from "./async-insert";
import type { Placement } from "./async-insert";

const logger = getLogger(["views", "annot-view"]);
const SOURCE_TAG = "application/x-zotlit-annotation";

interface AnnotationSnapshot {
  source: AnnotationSource | null;
  sourceScope: string | null;
}

interface AsyncInsertDeps {
  app: App;
  noteFeature: Pick<NoteFeatureHandle, "prepareAnnotationInsert">;
  snapshot: (annotation: AnnotationRecord) => AnnotationSnapshot;
  notify: (message: string | DocumentFragment) => void;
}

export type InsertionTarget = ReturnType<typeof captureInsertion>;

function fallbackText(annotation: AnnotationRecord): string {
  const key = parseIndexedKey(annotation.key);
  const parent = parseIndexedKey(annotation.parentKey);
  return (
    annotation.text ??
    `${m.excerpt_image_unavailable()}${key && parent ? ` [Zotero](${annotationOpenUri({ annotationKey: key.key, attachmentKey: parent.key, groupID: key.groupID, pageLabel: annotation.pageLabel })})` : ""}`
  );
}

/** What an Excerpt Image summary counts for one insert. */
type InsertSummary = NonNullable<
  Awaited<ReturnType<NoteFeatureHandle["prepareAnnotationInsert"]>>
>["summary"];

/** How one asynchronous annotation insert ended. */
export type AnnotationInsertOutcome =
  /** No note in Source mode or Live Preview takes the insert. */
  | { kind: "no-note" }
  /** The annotation's source is gone, so nothing is inserted. */
  | { kind: "source-unavailable" }
  /** The template could not render, and the fallback text took its place. */
  | { kind: "fallback"; landed: boolean }
  | { kind: "inserted"; summary: InsertSummary }
  /** A Profile error: the annotation's own text took the template's place. */
  | { kind: "profile-error"; error: ProfileAnnotationError; landed: boolean }
  /** The insert failed; the log keeps the error. */
  | { kind: "failed" }
  /** The target went away, or a newer insert took its place. */
  | { kind: "cancelled" };

/**
 * Render `annotation` through its note's template and commit it to `target`:
 * the fallback text where the template cannot render, the annotation's own
 * text for a Profile error. Whatever lands is placed by `placement`.
 */
export async function commitAnnotation(
  deps: Pick<AsyncInsertDeps, "noteFeature">,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    target: InsertionTarget;
    notePath: string;
    placement?: Placement;
  },
): Promise<AnnotationInsertOutcome> {
  const { annotation, snapshot, target, notePath, placement } = options;
  try {
    const result = await deps.noteFeature.prepareAnnotationInsert({
      annotation,
      source: snapshot.source!,
      sourceScope: snapshot.sourceScope!,
      notePath,
      signal: target.signal,
      valid: target.valid,
    });
    if (!result && target.valid())
      return {
        kind: "fallback",
        landed: target.commit(fallbackText(annotation), placement),
      };
    if (!result || !target.commit(result.text, placement))
      return { kind: "cancelled" };
    return { kind: "inserted", summary: result.summary };
  } catch (error) {
    if (target.signal.aborted || !target.valid()) return { kind: "cancelled" };
    if (error instanceof ProfileAnnotationError)
      return {
        kind: "profile-error",
        error,
        landed: target.commit(annotation.text ?? annotation.key, placement),
      };
    logger.warn("Annotation insert failed", {
      annotationKey: annotation.key,
      error,
    });
    return { kind: "failed" };
  }
}

/**
 * {@link commitAnnotation} with its outcome shown as a notice. Shared by every
 * asynchronous annotation insert: the card menu, a drop, and the Annotation
 * Suggester. Answers whether text landed.
 */
export async function prepareAndCommit(
  deps: Pick<AsyncInsertDeps, "app" | "noteFeature" | "notify">,
  options: Parameters<typeof commitAnnotation>[1],
): Promise<boolean> {
  const outcome = report(deps, await commitAnnotation(deps, options));
  switch (outcome.kind) {
    case "inserted":
      return true;
    case "fallback":
    case "profile-error":
      return outcome.landed;
    default:
      return false;
  }
}

/** Show the notice of `outcome`, if it has one, and answer `outcome`. */
function report(
  deps: Pick<AsyncInsertDeps, "app" | "notify">,
  outcome: AnnotationInsertOutcome,
): AnnotationInsertOutcome {
  const message = insertOutcomeMessage(deps.app, outcome);
  if (message !== null) deps.notify(message);
  return outcome;
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

export function createInsertHandler(deps: AsyncInsertDeps) {
  let pending: InsertionTarget | null = null;
  const cancel = () => pending?.cancel();
  const insertInto = async (
    annotation: AnnotationRecord,
    info: MarkdownFileInfo | null,
  ): Promise<AnnotationInsertOutcome> => {
    cancel();
    const { workspace } = deps.app;
    const editor = info?.editor;
    if (!info?.file || !editor) return report(deps, { kind: "no-note" });
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null)
      return report(deps, { kind: "source-unavailable" });
    using target = captureInsertion({
      editor,
      info,
      isCurrent: () => {
        const current = getInsertionEditor(deps.app);
        return current?.editor === editor && current.file === info.file;
      },
      workspace,
    });
    using cleanup = new DisposableStack();
    cleanup.defer(() => {
      if (pending === target) pending = null;
    });
    pending = target;
    return report(
      deps,
      await commitAnnotation(deps, {
        annotation,
        snapshot,
        target,
        notePath: info.file.path,
      }),
    );
  };
  const offer = () => {
    const info = getInsertionEditor(deps.app);
    const file = info?.file;
    const editor = info?.editor;
    if (!info || !file || !editor) return null;
    return async (annotation: AnnotationRecord) => {
      const current = getInsertionEditor(deps.app);
      if (
        current?.file !== file ||
        current.editor !== editor ||
        info.file !== file ||
        info.editor !== editor
      )
        return;
      await insertInto(annotation, info);
    };
  };
  const insert = (annotation: AnnotationRecord) =>
    insertInto(annotation, getInsertionEditor(deps.app));
  return Object.assign(insert, { cancel, offer });
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
      report(deps, { kind: "source-unavailable" });
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
    // eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
    dropEvent: globalThis.DragEvent;
    editor: Editor;
    info: MarkdownFileInfo;
    current: (target: InsertionTarget) => void;
    settled: (target: InsertionTarget) => void;
  },
): Promise<void> {
  const { editor, info } = options;
  const file = info.file;
  // The nearest position, as CodeMirror's own drop handler asks for: the
  // exact form is null over an empty active line.
  const position = editor.cm.posAtCoords(
    { x: options.dropEvent.clientX, y: options.dropEvent.clientY },
    false,
  );
  if (!file) {
    report(deps, { kind: "no-note" });
    return;
  }
  using target = captureInsertion({
    editor,
    info,
    range: { from: position, to: position },
    isCurrent: () => info.file === file && info.editor === editor,
    workspace: deps.app.workspace,
  });
  options.current(target);
  using cleanup = new DisposableStack();
  cleanup.defer(() => options.settled(target));
  await prepareAndCommit(deps, {
    annotation: options.annotation,
    snapshot: options.snapshot,
    target,
    notePath: file.path,
  });
}
