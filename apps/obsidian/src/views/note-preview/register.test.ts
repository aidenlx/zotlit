import type { App, Plugin, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  ProfileEditorView,
  PROFILE_EDITOR_VIEW_TYPE,
} from "@/views/profile-editor/view";
import type { ProfileEditorDeps } from "@/views/profile-editor/view";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";

import {
  activeProfileEditor,
  registerNotePreview,
  subscribeActiveProfileEditor,
} from "./register";
import { NOTE_PREVIEW_VIEW_TYPE } from "./view";

vi.mock("@/views/profile-editor/view", async () => {
  const { createStore } = await import("zustand/vanilla");
  return {
    PROFILE_EDITOR_VIEW_TYPE: "zotlit-profile-editor",
    ProfileEditorView: class {
      store = createStore(() => ({ explorer: "simple" }));
      ensureItem = vi.fn(async () => true);
      getViewType() {
        return "zotlit-profile-editor";
      }
    },
  };
});
vi.mock("@/views/template-data-explorer/view", () => ({
  EXPLORER_VIEW_TYPE: "zotlit-template-data-explorer",
}));
vi.mock("./view", () => ({
  NOTE_PREVIEW_VIEW_TYPE: "zotlit-note-preview",
  NotePreviewView: class {},
}));
function setup() {
  const memory = new Map<string, unknown>();
  const leaves: { view: { getViewType(): string } }[] = [];
  const callbacks = new Map<string, () => void>();
  const cleanup: (() => void)[] = [];
  const workspace = {
    activeLeaf: null as { view: { getViewType(): string } } | null,
    getLeavesOfType: (type: string) =>
      leaves.filter(({ view }) => view.getViewType() === type),
    on: (name: string, callback: () => void) => {
      callbacks.set(name, callback);
    },
    onLayoutReady: (callback: () => void) => callback(),
    rightSplit: { expand: vi.fn() },
    getRightLeaf: vi.fn(() => ({
      setViewState: async ({ type }: { type: string }) => {
        leaves.push({ view: { getViewType: () => type } });
      },
    })),
  };
  const app = {
    workspace,
    loadLocalStorage: (key: string) => memory.get(key),
    saveLocalStorage: (key: string, value: unknown) => memory.set(key, value),
  } as unknown as App;
  const plugin = {
    app,
    manifest: { id: "zotlit" },
    registerView: vi.fn(),
    registerEvent: vi.fn(),
    register: (dispose: () => void) => cleanup.push(dispose),
  } as unknown as Plugin;
  registerNotePreview(plugin);
  const editor = new ProfileEditorView(
    {} as WorkspaceLeaf,
    {} as ProfileEditorDeps,
  );
  const activate = (view: { getViewType(): string }) => {
    workspace.activeLeaf = { view };
    callbacks.get("active-leaf-change")?.();
  };
  return {
    app,
    workspace,
    leaves,
    editor,
    activate,
    callbacks,
    cleanup,
    memory,
  };
}

describe("active Profile Editor sidebars", () => {
  it("follows each editor, retains it in its sidebar, and clears when the editor closes", async () => {
    const test = setup();
    const seen: (ProfileEditorView | null)[] = [];
    const unsubscribe = subscribeActiveProfileEditor(test.app, (editor) =>
      seen.push(editor),
    );
    test.leaves.push({ view: test.editor });
    test.activate(test.editor);
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => NOTE_PREVIEW_VIEW_TYPE });
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => EXPLORER_VIEW_TYPE });
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.leaves.splice(0, 1);
    test.callbacks.get("layout-change")?.();
    expect(activeProfileEditor(test.app)).toBeNull();
    expect(seen).toEqual([null, test.editor, null]);
    unsubscribe();
    for (const dispose of test.cleanup) dispose();
  });

  it("opens both leaves once per vault and then respects closed leaves", async () => {
    const test = setup();
    test.leaves.push({ view: test.editor });
    test.activate(test.editor);
    await vi.waitFor(() =>
      expect(test.memory.get("zotlit.profile-sidebars-opened")).toBe(true),
    );
    expect(test.leaves.map(({ view }) => view.getViewType())).toEqual([
      PROFILE_EDITOR_VIEW_TYPE,
      EXPLORER_VIEW_TYPE,
      NOTE_PREVIEW_VIEW_TYPE,
    ]);
    expect(test.workspace.rightSplit.expand).toHaveBeenCalledOnce();
    test.leaves.splice(1);
    test.callbacks.get("layout-change")?.();
    await Promise.resolve();
    expect(test.workspace.getRightLeaf).toHaveBeenCalledTimes(2);
    expect(test.leaves).toHaveLength(1);
    for (const dispose of test.cleanup) dispose();
  });
  it("waits until Preview or Simple Explorer needs an Item", async () => {
    const test = setup();
    const ensureItem = vi.spyOn(test.editor, "ensureItem");
    test.memory.set("zotlit.profile-sidebars-opened", true);
    test.leaves.push({ view: test.editor });
    test.activate(test.editor);
    await Promise.resolve();
    expect(ensureItem).not.toHaveBeenCalled();
    test.editor.store.setState({ explorer: "all" });
    test.leaves.push({ view: { getViewType: () => EXPLORER_VIEW_TYPE } });
    test.callbacks.get("layout-change")?.();
    await Promise.resolve();
    expect(ensureItem).not.toHaveBeenCalled();
    test.editor.store.setState({ explorer: "simple" });
    expect(ensureItem).toHaveBeenCalledOnce();
    ensureItem.mockClear();
    test.editor.store.setState({ explorer: "all" });
    test.leaves.push({ view: { getViewType: () => NOTE_PREVIEW_VIEW_TYPE } });
    test.callbacks.get("layout-change")?.();
    await Promise.resolve();
    expect(ensureItem).toHaveBeenCalledOnce();
    for (const dispose of test.cleanup) dispose();
  });
});
