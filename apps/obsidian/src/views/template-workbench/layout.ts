// The dedicated workbench window, as Effects over the Workspace tag: "Open
// template workbench" and Customize show the editor with both side panels, in
// a window of its own. A leaf stays an edge: its view state is set through the
// leaf.
import { Deferred, Effect, Semaphore } from "effect";
import type { Cause } from "effect";
import type { ViewState, WorkspaceLeaf } from "obsidian";

import { Workspace } from "@/lib/obsidian-workspace";

import { showPanel } from "./model";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

type ProfileSource = { file: string | null; defaultProfile: boolean };

/**
 * One layout open at a time in the workspace, so a later open sees the leaves
 * an earlier one made. An open that fails or stops frees the turn.
 */
const layoutTurn = Semaphore.makeUnsafe(1);
/**
 * `effect` in the workspace's layout turn, for an open that adds a leaf: two
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

/**
 * The editor of this Profile in a window of its own, which is where a saved
 * dedicated workbench window restores. Restored leaves load first, so a
 * deferred one is read before it is passed over.
 */
export const findWorkbenchLayout = Effect.fn(
  "TemplateWorkbench.findWorkbenchLayout",
)(function* (source: ProfileSource, requesting?: TemplateWorkbenchView) {
  const workspace = yield* Workspace;
  const rootSplit = yield* workspace.rootSplit;
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
      candidate === requesting ||
      (source.defaultProfile && candidate.isDefaultProfile) ||
      (source.file !== null && candidate.file?.path === source.file)
    )
      return candidate;
  }
  return null;
});

/**
 * Reveal the Profile's workbench window, or move this editor into one, and
 * show both side panels there. A second open of the same editor joins the one
 * in progress.
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

const arrangeWorkbench = Effect.fn("TemplateWorkbench.arrangeWorkbench")(
  function* (editor: TemplateWorkbenchView) {
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
      yield* showWorkbench(existing);
      return;
    }
    const container = editor.leaf.getContainer();
    const otherEditor = (yield* workspace.leavesOfType(
      TEMPLATE_WORKBENCH_VIEW_TYPE,
    )).some(
      (leaf) => leaf !== editor.leaf && leaf.getContainer() === container,
    );
    if (
      container === (yield* workspace.rootSplit) ||
      (otherEditor && existing !== editor)
    ) {
      yield* workspace.moveLeafToPopout(editor.leaf, WORKBENCH_WINDOW);
      editor.onResize();
    }
    yield* showWorkbench(editor);
  },
);

/** Show both side panels of `editor`, reveal its leaf and give it the focus. */
const showWorkbench = Effect.fn("TemplateWorkbench.showWorkbench")(function* (
  editor: TemplateWorkbenchView,
) {
  editor.registry.update(editor.model.panels, (panels) =>
    showPanel("preview", true)(showPanel("fields", true)(panels)),
  );
  const workspace = yield* Workspace;
  yield* workspace.revealLeaf(editor.leaf);
  yield* workspace.setActiveLeaf(editor.leaf, { focus: true });
  editor.leaf.getContainer().focus();
});
