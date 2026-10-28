// The layout opens of the workbench panes, as Effects over the Workspace tag:
// the Note Preview and the Template data explorer beside their Template
// Workbench View, and the workbench window itself. A leaf stays an edge: its
// view state is set through the leaf.
import { Deferred, Effect, Semaphore } from "effect";
import type { Cause } from "effect";
import type { ViewState, WorkspaceLeaf } from "obsidian";

import { Workspace } from "@/lib/obsidian-workspace";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "@/views/template-workbench/view";

import { NOTE_PREVIEW_VIEW_TYPE } from "./view";

type ProfileSource = { file: string | null; defaultProfile: boolean };

/**
 * One layout open at a time in the workspace, so a later open sees the panes
 * an earlier one made. An open that fails or stops frees the turn.
 */
const layoutTurn = Semaphore.makeUnsafe(1);
/**
 * `effect` in the workspace's layout turn, for an open that adds a pane: two
 * opens at once add one.
 */
export const inLayoutTurn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  layoutTurn.withPermit(effect);
/** The layout open in progress for each editor, which a second open joins. */
const editorOpenings = new WeakMap<
  TemplateWorkbenchView,
  Deferred.Deferred<void, Cause.UnknownError>
>();

/** Obsidian's `setViewState` on `leaf`: a leaf stays an edge of the tags. */
export const setLeafState = (leaf: WorkspaceLeaf, state: ViewState) =>
  Effect.tryPromise(() => leaf.setViewState(state));

/** The size of the window a workbench opens in or moves into. */
export const WORKBENCH_WINDOW = { width: 1440, height: 900 } as const;

/** Each open Template data explorer and Note Preview leaf, in every window. */
const companionLeaves = Effect.fn("NotePreview.companionLeaves")(function* () {
  const workspace = yield* Workspace;
  return [
    ...(yield* workspace.leavesOfType(EXPLORER_VIEW_TYPE)),
    ...(yield* workspace.leavesOfType(NOTE_PREVIEW_VIEW_TYPE)),
  ];
});

/** Resolve restored leaves before deciding whether this Profile already has a workbench. */
export const findWorkbenchLayout = Effect.fn("NotePreview.findWorkbenchLayout")(
  function* (source: ProfileSource, requesting?: TemplateWorkbenchView) {
    const workspace = yield* Workspace;
    const rootSplit = yield* workspace.rootSplit;
    if (
      requesting?.leaf.group &&
      requesting.leaf.getContainer() !== rootSplit
    ) {
      if (
        (yield* companionLeaves()).some(
          (leaf) =>
            leaf.group === requesting.leaf.group &&
            leaf.getContainer() === requesting.leaf.getContainer(),
        )
      )
        return requesting;
    }
    for (const leaf of yield* workspace.leavesOfType(
      TEMPLATE_WORKBENCH_VIEW_TYPE,
    )) {
      if (leaf.getContainer() === rootSplit) continue;
      if (!(leaf.view instanceof TemplateWorkbenchView)) {
        const state = leaf.view.getState();
        if (
          state.file !== source.file &&
          !(source.defaultProfile && (state.defaultDraft || state.file))
        )
          continue;
        yield* Effect.tryPromise(() => leaf.loadIfDeferred());
      }
      const candidate = leaf.view;
      if (!(candidate instanceof TemplateWorkbenchView)) continue;
      if (
        candidate !== requesting &&
        !(source.defaultProfile && candidate.isDefaultProfile) &&
        !(source.file && candidate.file?.path === source.file)
      )
        continue;
      if (yield* hasWorkbenchPanes(candidate)) return candidate;
    }
    return null;
  },
);

/**
 * Reveal the Profile's workbench, or move this editor into a dedicated window.
 * A second open of the same editor joins the one in progress.
 */
export const openWorkbenchLayout = (
  editor: TemplateWorkbenchView,
): Effect.Effect<void, Cause.UnknownError, Workspace> =>
  // The entry and its release are set up before an interrupt can land, so an
  // open interrupted as it starts still frees the editor for the next open.
  Effect.uninterruptibleMask((restore) => {
    const pending = editorOpenings.get(editor);
    if (pending) return restore(Deferred.await(pending));
    const opening = Deferred.makeUnsafe<void, Cause.UnknownError>();
    editorOpenings.set(editor, opening);
    return restore(inLayoutTurn(arrangeWorkbench(editor))).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          editorOpenings.delete(editor);
        }).pipe(Effect.andThen(Deferred.done(opening, exit))),
      ),
    );
  });

const arrangeWorkbench = Effect.fn("NotePreview.arrangeWorkbench")(function* (
  editor: TemplateWorkbenchView,
) {
  const workspace = yield* Workspace;
  const existing = yield* findWorkbenchLayout(
    {
      file: editor.file?.path ?? null,
      defaultProfile: editor.isDefaultProfile,
    },
    editor,
  );
  if (existing && existing !== editor) {
    if (editor.file && !existing.file && existing.isDefaultProfile) {
      yield* setLeafState(existing.leaf, {
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: {
          ...existing.getState(),
          file: editor.file.path,
          defaultDraft: false,
        },
      });
    }
    yield* focusWorkbench(existing);
    return;
  }
  const container = editor.leaf.getContainer();
  const otherEditor = (yield* workspace.leavesOfType(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
  )).some((leaf) => leaf !== editor.leaf && leaf.getContainer() === container);
  const unrelatedCompanion = (yield* companionLeaves()).some(
    (leaf) =>
      leaf.getContainer() === container &&
      (!editor.leaf.group || leaf.group !== editor.leaf.group),
  );
  if (
    container === (yield* workspace.rootSplit) ||
    (otherEditor && existing !== editor) ||
    unrelatedCompanion
  ) {
    yield* workspace.moveLeafToPopout(editor.leaf, WORKBENCH_WINDOW);
    editor.onResize();
  }
  yield* openCompanion(editor, EXPLORER_VIEW_TYPE);
  yield* openCompanion(editor, NOTE_PREVIEW_VIEW_TYPE);
  yield* focusWorkbench(editor);
});

/** Reveal `editor`'s leaf and give it the focus. */
const focusWorkbench = Effect.fn("NotePreview.focusWorkbench")(function* (
  editor: TemplateWorkbenchView,
) {
  const workspace = yield* Workspace;
  yield* workspace.revealLeaf(editor.leaf);
  yield* workspace.setActiveLeaf(editor.leaf, { focus: true });
  editor.leaf.getContainer().focus();
});

const hasWorkbenchPanes = Effect.fn("NotePreview.hasWorkbenchPanes")(function* (
  editor: TemplateWorkbenchView,
) {
  const container = editor.leaf.getContainer();
  return (yield* companionLeaves()).some((leaf) => {
    if (leaf.getContainer() !== container) return false;
    if (editor.leaf.group && leaf.group === editor.leaf.group) return true;
    const state = leaf.view.getState();
    const source = state.source as
      | { path?: string; builtin?: boolean }
      | undefined;
    return (
      (!!editor.file &&
        (state.sourceFile === editor.file.path ||
          source?.path === editor.file.path)) ||
      (editor.isDefaultProfile && source?.builtin === true)
    );
  });
});

/** Reopen the result beside its editor without opening the other workbench pane. */
export const openNotePreview = (editor: TemplateWorkbenchView) =>
  inLayoutTurn(revealCompanion(editor, NOTE_PREVIEW_VIEW_TYPE));

/** Reopen the fields in the same window as the authoring session. */
export const openProfileExplorer = (editor: TemplateWorkbenchView) =>
  inLayoutTurn(revealCompanion(editor, EXPLORER_VIEW_TYPE));

const revealCompanion = Effect.fn("NotePreview.revealCompanion")(function* (
  editor: TemplateWorkbenchView,
  type: typeof EXPLORER_VIEW_TYPE | typeof NOTE_PREVIEW_VIEW_TYPE,
) {
  const leaf = yield* openCompanion(editor, type);
  yield* (yield* Workspace).revealLeaf(leaf);
  leaf.getContainer().focus();
});

const openCompanion = Effect.fn("NotePreview.openCompanion")(function* (
  editor: TemplateWorkbenchView,
  type: typeof EXPLORER_VIEW_TYPE | typeof NOTE_PREVIEW_VIEW_TYPE,
) {
  const workspace = yield* Workspace;
  const existing = (yield* workspace.leavesOfType(type)).find(
    (leaf) => !!editor.leaf.group && leaf.group === editor.leaf.group,
  );
  if (existing) return existing;
  const leaf = yield* workspace.createLeafBySplit(
    editor.leaf,
    "vertical",
    type === EXPLORER_VIEW_TYPE,
  );
  leaf.setGroupMember(editor.leaf);
  yield* setLeafState(leaf, { type, active: false });
  return leaf;
});
