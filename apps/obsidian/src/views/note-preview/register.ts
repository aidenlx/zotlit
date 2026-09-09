// Preview and Explorer follow the Profile Editor in their own window.
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { runProfileEditorAction } from "@/views/profile-editor/actions";
import {
  PROFILE_EDITOR_VIEW_TYPE,
  ProfileEditorView,
} from "@/views/profile-editor/view";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";

import { NotePreviewView, NOTE_PREVIEW_VIEW_TYPE } from "./view";

interface ActiveEditor {
  editor: ProfileEditorView | null;
  listeners: Map<
    (editor: ProfileEditorView | null) => void,
    { leaf?: WorkspaceLeaf; editor: ProfileEditorView | null }
  >;
  opening: Map<ProfileEditorView, Promise<void>>;
}
const sessions = new WeakMap<App, ActiveEditor>();
function session(app: App): ActiveEditor {
  let value = sessions.get(app);
  if (!value) {
    value = { editor: null, listeners: new Map(), opening: new Map() };
    sessions.set(app, value);
  }
  return value;
}
export function activeProfileEditor(
  app: App,
  leaf?: WorkspaceLeaf,
): ProfileEditorView | null {
  const active = session(app).editor;
  if (!leaf) return active;
  const container = leaf.getContainer();
  const focused = app.workspace.activeLeaf;
  if (
    focused?.getContainer() === container &&
    !(focused.view instanceof ProfileEditorView) &&
    focused.view.getViewType() !== NOTE_PREVIEW_VIEW_TYPE &&
    focused.view.getViewType() !== EXPLORER_VIEW_TYPE
  )
    return null;
  const open = app.workspace.getLeavesOfType(PROFILE_EDITOR_VIEW_TYPE);
  if (
    active?.leaf.getContainer() === container &&
    open.some((entry) => entry.view === active)
  )
    return active;
  const local = open.find((entry) => entry.getContainer() === container)?.view;
  return local instanceof ProfileEditorView ? local : null;
}
export function subscribeActiveProfileEditor(
  app: App,
  listener: (editor: ProfileEditorView | null) => void,
  leaf?: WorkspaceLeaf,
): () => void {
  const value = session(app);
  const editor = activeProfileEditor(app, leaf);
  value.listeners.set(listener, { leaf, editor });
  listener(editor);
  return () => {
    value.listeners.delete(listener);
  };
}
export function registerNotePreview(plugin: Plugin): void {
  const { app } = plugin;
  const value = session(app);
  plugin.registerView(
    NOTE_PREVIEW_VIEW_TYPE,
    (leaf) => new NotePreviewView(leaf, plugin.manifest.id),
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
  function refresh() {
    const leaf = app.workspace.activeLeaf;
    const view = leaf?.view;
    const sidebar =
      view?.getViewType() === NOTE_PREVIEW_VIEW_TYPE ||
      view?.getViewType() === EXPLORER_VIEW_TYPE;
    const editor =
      view instanceof ProfileEditorView
        ? view
        : sidebar && leaf
          ? activeProfileEditor(app, leaf)
          : null;
    value.editor = editor;
    for (const [listener, subscription] of value.listeners) {
      const local = activeProfileEditor(app, subscription.leaf);
      if (local === subscription.editor) continue;
      subscription.editor = local;
      listener(local);
    }
  }
  plugin.registerEvent(app.workspace.on("active-leaf-change", refresh));
  plugin.registerEvent(app.workspace.on("layout-change", refresh));
  app.workspace.onLayoutReady(refresh);
  plugin.register(() => {
    value.editor = null;
    for (const listener of value.listeners.keys()) listener(null);
    sessions.delete(app);
  });
}

/** Move the same authoring session into an explicit three-column window. */
export function openProfileWorkbench(
  app: App,
  editor: ProfileEditorView,
): Promise<void> {
  const value = session(app);
  const pending = value.opening.get(editor);
  if (pending) return pending;
  const opening = (async () => {
    const { workspace } = app;
    if (
      !editor.isWorkbenchWindow ||
      editor.leaf.getContainer() === workspace.rootSplit
    ) {
      workspace.moveLeafToPopout(editor.leaf, {
        size: { width: 1440, height: 900 },
      });
      editor.markWorkbenchWindow();
    }
    await openCompanion(app, editor, EXPLORER_VIEW_TYPE);
    await openCompanion(app, editor, NOTE_PREVIEW_VIEW_TYPE);
    await workspace.revealLeaf(editor.leaf);
    workspace.setActiveLeaf(editor.leaf, { focus: true });
    editor.leaf.getContainer().focus();
  })().finally(() => {
    value.opening.delete(editor);
  });
  value.opening.set(editor, opening);
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
  const container = editor.leaf.getContainer();
  const existing = workspace
    .getLeavesOfType(type)
    .find(
      (leaf) =>
        leaf.getContainer() === container &&
        leaf.getRoot() === editor.leaf.getRoot(),
    );
  if (existing) return existing;
  const leaf = workspace.createLeafBySplit(
    editor.leaf,
    "vertical",
    type === EXPLORER_VIEW_TYPE,
  );
  await leaf.setViewState({ type, active: false });
  return leaf;
}
