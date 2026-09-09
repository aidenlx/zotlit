// Explicit workbench opening and native group/follow association for companion views.
import type {
  App,
  Plugin,
  WorkspaceLeaf,
  ItemView,
  ViewStateResult,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { runProfileEditorAction } from "@/views/profile-editor/actions";
import {
  PROFILE_EDITOR_VIEW_TYPE,
  ProfileEditorView,
} from "@/views/profile-editor/view";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";

import type { PreviewViewDeps } from "./view";
import { NotePreviewView, NOTE_PREVIEW_VIEW_TYPE } from "./view";

const logger = getLogger(["views", "workbench-association"]);
const openings = new WeakMap<ProfileEditorView, Promise<void>>();

/**
 * Native history gates ItemViews on navigation, while Outline needs these panes
 * to remain non-navigating. Only the synchronous native recorder sees the proxy;
 * its history owner and history-change listeners keep the real leaf and view.
 */
export function registerCompanionHistory(view: ItemView): () => void {
  const leaf = view.leaf;
  const descriptor = Object.getOwnPropertyDescriptor(leaf, "recordHistory");
  // oxlint-disable-next-line typescript/unbound-method -- The native recorder receives an explicit proxy receiver below.
  const original = leaf.recordHistory;
  let owner: ItemView | null = view;
  const record = function (this: WorkspaceLeaf, state: unknown): void {
    const current = owner;
    if (!current || this.view !== current) return original.call(this, state);
    const historyView = new Proxy(current, {
      get(target, key) {
        return key === "navigation" ? true : Reflect.get(target, key, target);
      },
    });
    const receiver = new Proxy(this, {
      get(target, key) {
        return key === "view" ? historyView : Reflect.get(target, key, target);
      },
    });
    original.call(receiver, state);
  };
  leaf.recordHistory = record;
  return () => {
    owner = null;
    if (leaf.recordHistory !== record) return;
    if (descriptor) Object.defineProperty(leaf, "recordHistory", descriptor);
    else Reflect.deleteProperty(leaf, "recordHistory");
  };
}

/** Native completion follows group assignment; layout readiness also gates startup restores. */
export function onCompanionStateRestored(
  app: App,
  result: ViewStateResult,
  callback: () => void,
): void {
  const done = result.done;
  result.done = () => {
    done?.();
    app.workspace.onLayoutReady(callback);
  };
}

/** Native group order wins; unlinked panes follow Outline's app-wide file context. */
export function activeProfileEditor(
  app: App,
  leaf: WorkspaceLeaf | null = app.workspace.activeLeaf,
  retained: ProfileEditorView | null = null,
): ProfileEditorView | null {
  if (leaf?.view instanceof ProfileEditorView) return leaf.view;
  if (leaf?.group) {
    const editor = app.workspace
      .getGroupLeaves(leaf.group)
      .find((peer) => peer.view instanceof ProfileEditorView)?.view;
    return editor instanceof ProfileEditorView ? editor : null;
  }
  if (leaf?.pinned && leaf.view.getViewType() !== PROFILE_EDITOR_VIEW_TYPE)
    return retained &&
      app.workspace
        .getLeavesOfType(PROFILE_EDITOR_VIEW_TYPE)
        .some((peer) => peer.view === retained)
      ? retained
      : null;
  const view = app.workspace.getActiveFileView();
  return view instanceof ProfileEditorView ? view : null;
}

/** Each caller owns its native subscriptions, including peer layout changes. */
export function subscribeActiveProfileEditor(
  app: App,
  listener: (editor: ProfileEditorView | null) => void,
  leaf?: WorkspaceLeaf,
): () => void {
  using cleanup = new DisposableStack();
  let editor: ProfileEditorView | null = null;
  let ready = false;
  let initialized = false;
  let pinned = leaf?.pinned;
  let disposed = false;
  cleanup.defer(() => {
    disposed = true;
  });
  const refresh = () => {
    if (disposed || !ready) return;
    const next = activeProfileEditor(app, leaf, editor);
    const unpinned = pinned && !leaf?.pinned;
    pinned = leaf?.pinned;
    if (initialized && next === editor && !unpinned) return;
    initialized = true;
    logger.debug("Workbench editor binding changed", {
      leaf: leaf?.id ?? null,
      previousLeaf: editor?.leaf.id ?? null,
      nextLeaf: next?.leaf.id ?? null,
      mode: leaf?.group ? "group" : leaf?.pinned ? "pinned" : "follow",
      group: leaf?.group ?? null,
      pinned: leaf?.pinned ?? false,
    });
    editor = next;
    listener(editor);
  };
  for (const ref of [
    app.workspace.on("active-leaf-change", refresh),
    app.workspace.on("file-open", refresh),
    app.workspace.on("layout-change", refresh),
  ]) {
    cleanup.defer(() => app.workspace.offref(ref));
  }
  if (leaf) {
    for (const ref of [
      leaf.on("group-change", refresh),
      leaf.on("pinned-change", refresh),
    ]) {
      cleanup.defer(() => leaf.offref(ref));
    }
  }
  app.workspace.onLayoutReady(() => {
    ready = true;
    refresh();
  });
  const subscriptions = cleanup.move();
  return () => subscriptions.dispose();
}
export function registerNotePreview(
  plugin: Plugin,
  deps: PreviewViewDeps,
): void {
  const { app } = plugin;
  plugin.registerView(
    NOTE_PREVIEW_VIEW_TYPE,
    (leaf) => new NotePreviewView(leaf, plugin.manifest.id, deps),
  );
  plugin.addCommand({
    id: "open-template-workbench",
    name: m.profile_editor_open_workbench(),
    checkCallback(checking) {
      const editor = activeProfileEditor(app);
      if (!editor) return false;
      if (!checking)
        void runProfileEditorAction("open-workbench", () =>
          openProfileWorkbench(app, editor),
        );
      return true;
    },
  });
  plugin.addCommand({
    id: "open-note-preview",
    name: m.profile_preview_open(),
    checkCallback(checking) {
      const editor = activeProfileEditor(app);
      if (!editor) return false;
      if (!checking)
        void runProfileEditorAction("open-preview", () =>
          openNotePreview(app, editor),
        );
      return true;
    },
  });
}

/** Move the same authoring session into an explicit three-column window. */
export function openProfileWorkbench(
  app: App,
  editor: ProfileEditorView,
): Promise<void> {
  const pending = openings.get(editor);
  if (pending) return pending;
  const opening = (async () => {
    const { workspace } = app;
    if (editor.leaf.getContainer() === workspace.rootSplit) {
      workspace.moveLeafToPopout(editor.leaf, {
        size: { width: 1440, height: 900 },
      });
      editor.onResize();
    }
    await openCompanion(app, editor, EXPLORER_VIEW_TYPE);
    await openCompanion(app, editor, NOTE_PREVIEW_VIEW_TYPE);
    await workspace.revealLeaf(editor.leaf);
    workspace.setActiveLeaf(editor.leaf, { focus: true });
    editor.leaf.getContainer().focus();
  })().finally(() => {
    openings.delete(editor);
  });
  openings.set(editor, opening);
  return opening;
}

/** Reopen the result beside its editor without opening the other workbench pane. */
export async function openNotePreview(
  app: App,
  editor: ProfileEditorView,
): Promise<void> {
  const leaf = await openCompanion(app, editor, NOTE_PREVIEW_VIEW_TYPE);
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
}

/** Reopen the fields in the same window as the authoring session. */
export async function openProfileExplorer(
  app: App,
  editor: ProfileEditorView,
): Promise<void> {
  const leaf = await openCompanion(app, editor, EXPLORER_VIEW_TYPE);
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
}

async function openCompanion(
  app: App,
  editor: ProfileEditorView,
  type: typeof EXPLORER_VIEW_TYPE | typeof NOTE_PREVIEW_VIEW_TYPE,
): Promise<WorkspaceLeaf> {
  const { workspace } = app;
  const existing = workspace
    .getLeavesOfType(type)
    .find((leaf) => !!editor.leaf.group && leaf.group === editor.leaf.group);
  if (existing) return existing;
  const leaf = workspace.createLeafBySplit(
    editor.leaf,
    "vertical",
    type === EXPLORER_VIEW_TYPE,
  );
  leaf.setGroupMember(editor.leaf);
  await leaf.setViewState({ type, active: false });
  return leaf;
}
