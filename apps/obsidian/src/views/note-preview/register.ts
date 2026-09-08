// One active Profile Editor shared by both sidebar leaves, scoped to the vault app.
import type { App, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import {
  PROFILE_EDITOR_VIEW_TYPE,
  ProfileEditorView,
} from "@/views/profile-editor/view";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";

import { NotePreviewView, NOTE_PREVIEW_VIEW_TYPE } from "./view";

interface ActiveEditor {
  editor: ProfileEditorView | null;
  listeners: Set<(editor: ProfileEditorView | null) => void>;
}
const logger = getLogger(["note-preview", "register"]);
const sessions = new WeakMap<App, ActiveEditor>();
function session(app: App): ActiveEditor {
  let value = sessions.get(app);
  if (!value) {
    value = { editor: null, listeners: new Set() };
    sessions.set(app, value);
  }
  return value;
}
export function activeProfileEditor(app: App): ProfileEditorView | null {
  return session(app).editor;
}
export function subscribeActiveProfileEditor(
  app: App,
  listener: (editor: ProfileEditorView | null) => void,
): () => void {
  const value = session(app);
  value.listeners.add(listener);
  listener(value.editor);
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
  let opening = false;
  async function firstOpen() {
    if (
      opening ||
      app.loadLocalStorage("zotlit.profile-sidebars-opened") === true
    )
      return;
    opening = true;
    try {
      for (const type of [EXPLORER_VIEW_TYPE, NOTE_PREVIEW_VIEW_TYPE]) {
        if (app.workspace.getLeavesOfType(type).length) continue;
        const leaf = app.workspace.getRightLeaf(false);
        if (leaf) await leaf.setViewState({ type, active: false });
      }
      app.workspace.rightSplit.expand();
      app.saveLocalStorage("zotlit.profile-sidebars-opened", true);
    } finally {
      opening = false;
    }
  }
  function refresh() {
    const leaf = app.workspace.activeLeaf;
    const open = app.workspace.getLeavesOfType(PROFILE_EDITOR_VIEW_TYPE);
    const view = leaf?.view;
    const sidebar =
      view?.getViewType() === NOTE_PREVIEW_VIEW_TYPE ||
      view?.getViewType() === EXPLORER_VIEW_TYPE;
    const editor =
      view instanceof ProfileEditorView
        ? view
        : sidebar && open.some((entry) => entry.view === value.editor)
          ? value.editor
          : null;
    if (editor !== value.editor) {
      value.editor = editor;
      for (const listener of value.listeners) listener(editor);
    }
    if (editor) {
      void firstOpen().catch((error: unknown) => {
        logger.warn("Profile sidebars could not open", { error });
      });
    }
  }
  plugin.registerEvent(app.workspace.on("active-leaf-change", refresh));
  plugin.registerEvent(app.workspace.on("layout-change", refresh));
  app.workspace.onLayoutReady(refresh);
  plugin.register(() => {
    value.editor = null;
    for (const listener of value.listeners) listener(null);
    sessions.delete(app);
  });
}
