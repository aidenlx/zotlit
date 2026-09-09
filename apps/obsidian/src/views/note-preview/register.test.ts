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
  openNotePreview,
  openProfileWorkbench,
  registerNotePreview,
  subscribeActiveProfileEditor,
} from "./register";
import { NOTE_PREVIEW_VIEW_TYPE } from "./view";

vi.mock("@/views/profile-editor/view", async () => {
  const { createStore } = await import("zustand/vanilla");
  return {
    PROFILE_EDITOR_VIEW_TYPE: "zotlit-profile-editor",
    ProfileEditorView: class {
      constructor(readonly leaf: WorkspaceLeaf) {}
      isWorkbenchWindow = false;
      markWorkbenchWindow() {
        this.isWorkbenchWindow = true;
      }
      store = createStore(() => ({ explorer: "simple" }));
      ensureItem = vi.fn(async () => true);
      onResize = vi.fn();
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
function events() {
  const callbacks = new Map<string, Set<() => void>>();
  return {
    on(this: void, name: string, callback: () => void) {
      if (!callbacks.has(name)) callbacks.set(name, new Set());
      callbacks.get(name)!.add(callback);
      return { name, callback };
    },
    offref(this: void, ref: { name: string; callback: () => void }) {
      callbacks.get(ref.name)?.delete(ref.callback);
    },
    trigger(name: string) {
      for (const callback of callbacks.get(name) ?? []) callback();
    },
    get(name: string) {
      return () => this.trigger(name);
    },
  };
}
function setup() {
  const rootSplit = { focus: vi.fn() };
  type TestContainer = typeof rootSplit;
  type TestLeaf = {
    view: { getViewType(): string };
    container: TestContainer;
    parent: object;
    group: string | null;
    pinned: boolean;
    activeTime: number;
    on: ReturnType<typeof events>["on"];
    offref: ReturnType<typeof events>["offref"];
    trigger: ReturnType<typeof events>["trigger"];
    setGroupMember(peer: TestLeaf): void;
    getContainer(): TestContainer;
    getRoot(): TestContainer;
    setViewState: ReturnType<typeof vi.fn>;
  };
  const leaves: TestLeaf[] = [];
  const callbacks = events();
  const cleanup: (() => void)[] = [];
  const commands = new Map<
    string,
    { checkCallback(checking: boolean): boolean }
  >();
  const makeLeaf = (container = rootSplit): TestLeaf => {
    const leaf: TestLeaf = {
      view: { getViewType: () => "empty" },
      container,
      parent: {},
      group: null,
      pinned: false,
      activeTime: 0,
      ...events(),
      setGroupMember(peer) {
        peer.group ??= `group-${leaves.indexOf(peer)}`;
        this.group = peer.group;
        peer.trigger("group-change");
        this.trigger("group-change");
        callbacks.trigger("layout-change");
      },
      getContainer() {
        return this.container;
      },
      getRoot() {
        return this.container;
      },
      setViewState: vi.fn(async ({ type }: { type: string }) => {
        leaf.view = { getViewType: () => type };
      }),
    };
    leaves.push(leaf);
    return leaf;
  };
  const workspace = {
    rootSplit,
    activeLeaf: null as TestLeaf | null,
    getLeavesOfType: (type: string) =>
      leaves.filter(({ view }) => view.getViewType() === type),
    on: callbacks.on,
    offref: callbacks.offref,
    getGroupLeaves: (group: string) =>
      leaves.filter((leaf) => leaf.group === group),
    getActiveFileView() {
      const navigating = (leaf: TestLeaf) =>
        ![NOTE_PREVIEW_VIEW_TYPE, EXPLORER_VIEW_TYPE, "empty"].includes(
          leaf.view.getViewType(),
        );
      const active = this.activeLeaf;
      const leaf =
        active && navigating(active)
          ? active
          : leaves
              .filter(navigating)
              .sort((a, b) => b.activeTime - a.activeTime)[0];
      return leaf?.view ?? null;
    },
    onLayoutReady: (callback: () => void) => callback(),
    rightSplit: { expand: vi.fn() },
    getRightLeaf: vi.fn(),
    moveLeafToPopout: vi.fn((leaf: TestLeaf) => {
      leaf.container = { focus: vi.fn() };
      return leaf.container;
    }),
    createLeafBySplit: vi.fn((leaf: TestLeaf) => makeLeaf(leaf.container)),
    revealLeaf: vi.fn(async () => {}),
    setActiveLeaf: vi.fn((leaf: TestLeaf) => {
      workspace.activeLeaf = leaf;
      callbacks.get("active-leaf-change")?.();
    }),
  };
  const app = { workspace } as unknown as App;
  const plugin = {
    app,
    manifest: { id: "zotlit" },
    registerView: vi.fn(),
    registerEvent: vi.fn(),
    addCommand: (command: {
      id: string;
      checkCallback(checking: boolean): boolean;
    }) => commands.set(command.id, command),
    register: (dispose: () => void) => cleanup.push(dispose),
  } as unknown as Plugin;
  registerNotePreview(plugin);
  const editorLeaf = makeLeaf();
  const editor = new ProfileEditorView(
    editorLeaf as unknown as WorkspaceLeaf,
    {} as ProfileEditorDeps,
  );
  editorLeaf.view = editor;
  const activate = (view: { getViewType(): string }) => {
    const leaf = leaves.find((entry) => entry.view === view) ?? makeLeaf();
    leaf.view = view;
    workspace.activeLeaf = leaf;
    leaf.activeTime = Math.max(...leaves.map((entry) => entry.activeTime)) + 1;
    callbacks.get("active-leaf-change")?.();
  };
  return {
    app,
    workspace,
    leaves,
    editor,
    editorLeaf,
    activate,
    callbacks,
    cleanup,
    commands,
    makeLeaf,
  };
}

describe("active Profile Editor sidebars", () => {
  it("removes a subscription whose initial binding fails", () => {
    const test = setup();
    const listener = vi.fn<() => void>(() => {
      throw new Error("Binding unavailable");
    });
    expect(() => subscribeActiveProfileEditor(test.app, listener)).toThrow(
      "Binding unavailable",
    );
    listener.mockImplementation(() => {});
    test.activate(test.editor);
    expect(listener).toHaveBeenCalledOnce();
    for (const dispose of test.cleanup) dispose();
  });

  it("follows each editor, retains it in its sidebar, and clears when the editor closes", async () => {
    const test = setup();
    const seen: (ProfileEditorView | null)[] = [];
    const unsubscribe = subscribeActiveProfileEditor(test.app, (editor) =>
      seen.push(editor),
    );
    test.activate(test.editor);
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => NOTE_PREVIEW_VIEW_TYPE });
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => EXPLORER_VIEW_TYPE });
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.leaves.splice(0, 1);
    test.callbacks.get("layout-change")?.();
    expect(activeProfileEditor(test.app)).toBeNull();
    expect(seen).toEqual([test.editor, null]);
    unsubscribe();
    for (const dispose of test.cleanup) dispose();
  });

  it("keeps startup and editor activation free of new leaves", async () => {
    const test = setup();
    test.activate(test.editor);
    test.callbacks.get("layout-change")?.();
    await Promise.resolve();
    expect(test.leaves.map(({ view }) => view.getViewType())).toEqual([
      PROFILE_EDITOR_VIEW_TYPE,
    ]);
    expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
    expect(test.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(test.workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(test.workspace.rightSplit.expand).not.toHaveBeenCalled();
  });

  it("returns local companion views to the empty state when a normal note is activated", () => {
    const test = setup();
    test.activate(test.editor);
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    const seen: (ProfileEditorView | null)[] = [];
    subscribeActiveProfileEditor(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    test.activate({ getViewType: () => "markdown" });
    expect(seen).toEqual([test.editor, null]);
  });

  it("moves the same editor into three columns only on explicit action and reuses its window", async () => {
    const test = setup();
    test.activate(test.editor);
    const first = openProfileWorkbench(test.app, test.editor);
    expect(openProfileWorkbench(test.app, test.editor)).toBe(first);
    await first;
    expect(test.workspace.moveLeafToPopout).toHaveBeenCalledExactlyOnceWith(
      test.editorLeaf,
      { size: { width: 1440, height: 900 } },
    );
    expect(test.editorLeaf.view).toBe(test.editor);
    expect(test.workspace.createLeafBySplit.mock.calls).toEqual([
      [test.editorLeaf, "vertical", true],
      [test.editorLeaf, "vertical", false],
    ]);
    expect(test.leaves.map(({ view }) => view.getViewType())).toEqual([
      PROFILE_EDITOR_VIEW_TYPE,
      EXPLORER_VIEW_TYPE,
      NOTE_PREVIEW_VIEW_TYPE,
    ]);
    expect(
      test.leaves.every((leaf) => leaf.container === test.editorLeaf.container),
    ).toBe(true);
    await openProfileWorkbench(test.app, test.editor);
    expect(test.workspace.moveLeafToPopout).toHaveBeenCalledOnce();
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
    expect(test.editorLeaf.container.focus).toHaveBeenCalledTimes(2);
  });

  it("opens a dedicated window when the editor starts in an ordinary popout", async () => {
    const test = setup();
    const ordinary = { focus: vi.fn() };
    test.editorLeaf.container = ordinary;
    test.activate(test.editor);
    await openProfileWorkbench(test.app, test.editor);
    expect(test.workspace.moveLeafToPopout).toHaveBeenCalledOnce();
    expect(test.editorLeaf.container).not.toBe(ordinary);
    expect(test.editor.isWorkbenchWindow).toBe(true);
  });

  it("reuses a restored workbench window even when its companion panes are closed", async () => {
    const test = setup();
    const restored = { focus: vi.fn() };
    test.editorLeaf.container = restored;
    test.editor.markWorkbenchWindow();
    test.activate(test.editor);
    await openProfileWorkbench(test.app, test.editor);
    expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
    expect(test.leaves.every((leaf) => leaf.container === restored)).toBe(true);
  });

  it("keeps a closed preview closed until its reopen command runs in the workbench window", async () => {
    const test = setup();
    test.activate(test.editor);
    await openProfileWorkbench(test.app, test.editor);
    test.leaves.splice(2, 1);
    test.callbacks.get("layout-change")?.();
    test.activate(test.editor);
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
    const command = test.commands.get("open-note-preview")!;
    expect(command.checkCallback(true)).toBe(true);
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
    command.checkCallback(false);
    await vi.waitFor(() =>
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3),
    );
    expect(test.leaves[2]!.getContainer()).toBe(test.editorLeaf.getContainer());
    await openNotePreview(test.app, test.editor);
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3);
  });

  it("binds companion views to their native group across windows", async () => {
    const test = setup();
    test.activate(test.editor);
    await openProfileWorkbench(test.app, test.editor);
    const companion = test.leaves[1]!;
    const seen: (ProfileEditorView | null)[] = [];
    subscribeActiveProfileEditor(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    const otherLeaf = test.makeLeaf();
    const other = new ProfileEditorView(
      otherLeaf as unknown as WorkspaceLeaf,
      {} as ProfileEditorDeps,
    );
    otherLeaf.view = other;
    test.activate(other);
    expect(activeProfileEditor(test.app)).toBe(other);
    expect(seen).toEqual([test.editor]);
    test.activate(companion.view);
    expect(activeProfileEditor(test.app)).toBe(test.editor);
    test.leaves.splice(2, 1);
    test.commands.get("open-note-preview")!.checkCallback(false);
    await vi.waitFor(() =>
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3),
    );
    expect(test.workspace.createLeafBySplit).toHaveBeenLastCalledWith(
      test.editorLeaf,
      "vertical",
      false,
    );
  });
  it("uses native group order across windows and detects peers joining and closing", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    const companion = test.makeLeaf({ focus: vi.fn() });
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.group = "research";
    const seen: (ProfileEditorView | null)[] = [];
    const dispose = subscribeActiveProfileEditor(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    cleanup.defer(dispose);
    expect(seen).toEqual([null]);
    const secondLeaf = test.makeLeaf();
    const second = new ProfileEditorView(
      secondLeaf as unknown as WorkspaceLeaf,
      {} as ProfileEditorDeps,
    );
    secondLeaf.view = second;
    secondLeaf.group = "research";
    test.callbacks.trigger("layout-change");
    expect(seen).toEqual([null, second]);
    test.editorLeaf.group = "research";
    test.callbacks.trigger("layout-change");
    expect(seen.at(-1)).toBe(test.editor);
    test.leaves.splice(test.leaves.indexOf(test.editorLeaf), 1);
    test.callbacks.trigger("layout-change");
    expect(seen.at(-1)).toBe(second);
    test.leaves.splice(test.leaves.indexOf(secondLeaf), 1);
    test.callbacks.trigger("layout-change");
    expect(seen.at(-1)).toBeNull();
  });

  it("keeps unrelated native groups separate in the same window", () => {
    const test = setup();
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.setGroupMember(test.editorLeaf);
    const otherLeaf = test.makeLeaf();
    const other = new ProfileEditorView(
      otherLeaf as unknown as WorkspaceLeaf,
      {} as ProfileEditorDeps,
    );
    otherLeaf.view = other;
    test.activate(other);
    expect(
      activeProfileEditor(test.app, companion as unknown as WorkspaceLeaf),
    ).toBe(test.editor);
    companion.group = "empty-group";
    expect(
      activeProfileEditor(test.app, companion as unknown as WorkspaceLeaf),
    ).toBeNull();
    companion.group = null;
    expect(
      activeProfileEditor(test.app, companion as unknown as WorkspaceLeaf),
    ).toBe(other);
  });

  it("holds an unlinked pinned editor and follows the current file after unpin", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    test.activate(test.editor);
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    const seen: (ProfileEditorView | null)[] = [];
    const dispose = subscribeActiveProfileEditor(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    cleanup.defer(dispose);
    companion.pinned = true;
    companion.trigger("pinned-change");
    const otherLeaf = test.makeLeaf({ focus: vi.fn() });
    const other = new ProfileEditorView(
      otherLeaf as unknown as WorkspaceLeaf,
      {} as ProfileEditorDeps,
    );
    otherLeaf.view = other;
    test.activate(other);
    test.activate(companion.view);
    expect(seen).toEqual([test.editor]);
    companion.pinned = false;
    companion.trigger("pinned-change");
    expect(seen).toEqual([test.editor, other]);
    dispose();
    companion.group = "missing";
    companion.trigger("group-change");
    test.callbacks.trigger("layout-change");
    expect(seen).toEqual([test.editor, other]);
  });

  it("rechecks a source becoming available on file-open and retains no closed pinned editor", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.group = "restored";
    const seen: (ProfileEditorView | null)[] = [];
    const dispose = subscribeActiveProfileEditor(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    cleanup.defer(dispose);
    test.editorLeaf.group = "restored";
    test.callbacks.trigger("file-open");
    expect(seen).toEqual([null, test.editor]);
    companion.group = null;
    companion.pinned = true;
    companion.trigger("pinned-change");
    test.leaves.splice(test.leaves.indexOf(test.editorLeaf), 1);
    test.callbacks.trigger("layout-change");
    expect(seen.at(-1)).toBeNull();
  });

  it("preserves an editor's existing native group on move and reuses its cross-window companions", async () => {
    const test = setup();
    const preview = test.makeLeaf();
    preview.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    preview.setGroupMember(test.editorLeaf);
    const group = test.editorLeaf.group;
    const resize = vi.spyOn(test.editor, "onResize");
    await openProfileWorkbench(test.app, test.editor);
    expect(test.editorLeaf.group).toBe(group);
    expect(preview.group).toBe(group);
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(1);
    expect(test.leaves.every((leaf) => leaf.group === group)).toBe(true);
    expect(resize).toHaveBeenCalledOnce();
  });
  it("reports an earlier native group peer while pinned and repeats its binding on unpin", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.pinned = true;
    const heldLeaf = test.makeLeaf();
    const held = new ProfileEditorView(
      heldLeaf as unknown as WorkspaceLeaf,
      {} as ProfileEditorDeps,
    );
    heldLeaf.view = held;
    companion.setGroupMember(heldLeaf);
    const seen: (ProfileEditorView | null)[] = [];
    cleanup.defer(
      subscribeActiveProfileEditor(
        test.app,
        (editor) => seen.push(editor),
        companion as unknown as WorkspaceLeaf,
      ),
    );
    test.editorLeaf.group = companion.group;
    test.callbacks.trigger("layout-change");
    expect(seen).toEqual([held, test.editor]);
    companion.pinned = false;
    companion.trigger("pinned-change");
    expect(seen).toEqual([held, test.editor, test.editor]);
  });
});
