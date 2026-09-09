import type { App, Plugin, WorkspaceLeaf, ItemView } from "obsidian";
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
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveProfileEditor,
} from "./register";
import { NOTE_PREVIEW_VIEW_TYPE } from "./view";

vi.mock("@/views/profile-editor/view", async () => {
  const { createStore } = await import("zustand/vanilla");
  let nextProfile = 0;
  return {
    PROFILE_EDITOR_VIEW_TYPE: "zotlit-profile-editor",
    ProfileEditorView: class {
      constructor(readonly leaf: WorkspaceLeaf) {}
      file = { path: `templates/profile-${++nextProfile}.md` };
      isDefaultProfile = false;
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
    view: { getViewType(): string; getState?(): Record<string, unknown> };
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
        leaf.view = { getViewType: () => type, getState: () => ({}) };
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
  registerNotePreview(plugin, {} as import("./view").PreviewViewDeps);
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

function addEditor(
  test: ReturnType<typeof setup>,
  options: {
    container?: ReturnType<typeof setup>["editorLeaf"]["container"];
    path: string | null;
    defaultProfile?: boolean;
  },
) {
  const leaf = test.makeLeaf(options.container);
  const editor = new ProfileEditorView(
    leaf as unknown as WorkspaceLeaf,
    {} as ProfileEditorDeps,
  );
  Object.assign(editor, {
    file: options.path === null ? null : { path: options.path },
    isDefaultProfile: options.defaultProfile ?? false,
  });
  leaf.view = editor;
  return { editor, leaf };
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

  it("loads a deferred saved workbench before reusing its window", async () => {
    const test = setup();
    const restored = addEditor(test, {
      container: { focus: vi.fn() },
      path: test.editor.file!.path,
    });
    restored.leaf.group = "saved-workbench";
    const preview = test.makeLeaf(restored.leaf.container);
    preview.group = "saved-workbench";
    preview.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    restored.leaf.view = {
      getViewType: () => PROFILE_EDITOR_VIEW_TYPE,
      getState: () => ({ file: test.editor.file!.path }),
    };
    const load = vi.fn(async () => {
      restored.leaf.view = restored.editor;
    });
    Object.assign(restored.leaf, { loadIfDeferred: load });
    await openProfileWorkbench(test.app, test.editor);
    expect(load).toHaveBeenCalledOnce();
    expect(test.workspace.revealLeaf).toHaveBeenCalledWith(restored.leaf);
    expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
    expect(test.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });

  it("moves the requested editor when another compact editor has the same Profile", async () => {
    const test = setup();
    const compact = addEditor(test, {
      container: { focus: vi.fn() },
      path: test.editor.file!.path,
    });
    await openProfileWorkbench(test.app, test.editor);
    expect(test.workspace.moveLeafToPopout).toHaveBeenCalledWith(
      test.editorLeaf,
      { size: { width: 1440, height: 900 } },
    );
    expect(test.workspace.revealLeaf).toHaveBeenCalledWith(test.editorLeaf);
    expect(compact.leaf.group).toBeNull();
  });

  it("moves an editor out of a window with unrelated unlinked companions", async () => {
    const test = setup();
    const original = { focus: vi.fn() };
    test.editorLeaf.container = original;
    const pinned = test.makeLeaf(original);
    pinned.pinned = true;
    pinned.view = {
      getViewType: () => NOTE_PREVIEW_VIEW_TYPE,
      getState: () => ({ source: { path: "templates/other.md" } }),
    };
    await openProfileWorkbench(test.app, test.editor);
    expect(test.editorLeaf.container).not.toBe(original);
    expect(pinned.container).toBe(original);
    expect(pinned.group).toBeNull();
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  });

  it("adds companions in the existing native window of a popout editor", async () => {
    const test = setup();
    const ordinary = { focus: vi.fn() };
    test.editorLeaf.container = ordinary;
    test.activate(test.editor);
    await openProfileWorkbench(test.app, test.editor);
    expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
    expect(test.editorLeaf.container).toBe(ordinary);
    expect(test.leaves.every((leaf) => leaf.container === ordinary)).toBe(true);
  });

  it("reuses a restored workbench window even when its companion panes are closed", async () => {
    const test = setup();
    const restored = { focus: vi.fn() };
    test.editorLeaf.container = restored;
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

it("lets native history capture a companion while synchronous listeners still see a non-navigating view", () => {
  const snapshots: unknown[] = [];
  const view = { navigation: false } as ItemView;
  const history = { owner: null as unknown as WorkspaceLeaf };
  const leaf = {
    view,
    history,
    recordHistory(this: WorkspaceLeaf, state: unknown) {
      if (!this.view.navigation) return;
      expect(leaf.view.navigation).toBe(false);
      expect(history.owner).toBe(leaf);
      snapshots.push(state);
    },
  } as unknown as WorkspaceLeaf;
  history.owner = leaf;
  Object.assign(view, { leaf });
  const native = Object.getOwnPropertyDescriptor(leaf, "recordHistory")!.value;
  const remove = registerCompanionHistory(view);
  const snapshot = {
    state: { item: "PAPER001" },
    eState: { zotlitPreview: { scrollTop: 30 } },
  };
  leaf.recordHistory(snapshot);
  expect(snapshots).toEqual([snapshot]);
  expect(view.navigation).toBe(false);
  leaf.view = { navigation: false } as ItemView;
  leaf.recordHistory({ state: { item: "PAPER002" } });
  expect(snapshots).toHaveLength(1);
  remove();
  expect(Object.getOwnPropertyDescriptor(leaf, "recordHistory")!.value).toBe(
    native,
  );
});

it("waits for native layout readiness before choosing a restored companion's source", () => {
  const test = setup();
  let ready = () => {};
  test.workspace.onLayoutReady = (callback: () => void) => {
    ready = callback;
  };
  test.activate(test.editor);
  const listener = vi.fn();
  const stop = subscribeActiveProfileEditor(test.app, listener);
  test.callbacks.get("layout-change")?.();
  expect(listener).not.toHaveBeenCalled();
  ready();
  expect(listener).toHaveBeenLastCalledWith(test.editor);
  stop();
  listener.mockClear();
  ready();
  expect(listener).not.toHaveBeenCalled();
});

it("preserves native completion before waiting for layout-ready restoration", () => {
  const events: string[] = [];
  let ready = () => {};
  const app = {
    workspace: {
      onLayoutReady(callback: () => void) {
        ready = callback;
      },
    },
  } as App;
  const result = {
    history: false,
    done: () => {
      events.push("native done");
    },
  };
  onCompanionStateRestored(app, result, () => {
    events.push("restore");
  });
  expect(events).toEqual([]);
  result.done();
  expect(events).toEqual(["native done"]);
  ready();
  expect(events).toEqual(["native done", "restore"]);
});

it("reveals an existing file-backed Default workbench for a compact built-in Default without adding columns", async () => {
  const test = setup();
  Object.assign(test.editor, {
    file: { path: "templates/zotlit-profile.default.md" },
    isDefaultProfile: true,
  });
  await openProfileWorkbench(test.app, test.editor);
  const window = test.editorLeaf.container;
  const compact = addEditor(test, {
    container: { focus: vi.fn() },
    path: null,
    defaultProfile: true,
  });
  await openProfileWorkbench(test.app, compact.editor);
  expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(test.editorLeaf);
  expect(test.workspace.setActiveLeaf).toHaveBeenLastCalledWith(
    test.editorLeaf,
    { focus: true },
  );
  expect(window.focus).toHaveBeenCalledTimes(2);
  expect(compact.leaf.container).not.toBe(window);
});

it("moves another Profile's compact editor out of an existing workbench window and reuses its new workbench", async () => {
  const test = setup();
  await openProfileWorkbench(test.app, test.editor);
  const firstWindow = test.editorLeaf.container;
  const originalLeaves = [...test.leaves];
  const books = addEditor(test, {
    container: firstWindow,
    path: "templates/books.md",
  });
  const historyOwner = books.editor;
  await openProfileWorkbench(test.app, books.editor);
  expect(test.workspace.moveLeafToPopout).toHaveBeenLastCalledWith(books.leaf, {
    size: { width: 1440, height: 900 },
  });
  expect(books.leaf.view).toBe(historyOwner);
  expect(books.leaf.container).not.toBe(firstWindow);
  expect(originalLeaves.every((leaf) => leaf.container === firstWindow)).toBe(
    true,
  );
  expect(
    test.leaves.filter((leaf) => leaf.container === firstWindow),
  ).toHaveLength(3);
  expect(
    test.leaves.filter((leaf) => leaf.container === books.leaf.container),
  ).toHaveLength(3);
  expect(books.leaf.group).not.toBe(test.editorLeaf.group);
  const compact = addEditor(test, { path: "templates/books.md" });
  await openProfileWorkbench(test.app, compact.editor);
  expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(2);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(4);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(books.leaf);
});

it("keeps an unlinked or partially closed workbench window occupied when another Profile opens", async () => {
  const test = setup();
  await openProfileWorkbench(test.app, test.editor);
  const firstWindow = test.editorLeaf.container;
  const preview = test.leaves.find(
    (leaf) => leaf.view.getViewType() === NOTE_PREVIEW_VIEW_TYPE,
  )!;
  test.leaves.splice(test.leaves.indexOf(preview), 1);
  const explorer = test.leaves.find(
    (leaf) => leaf.view.getViewType() === EXPLORER_VIEW_TYPE,
  )!;
  explorer.group = null;
  test.editorLeaf.group = null;
  explorer.view.getState = () => ({ sourceFile: test.editor.file!.path });
  const books = addEditor(test, {
    container: firstWindow,
    path: "templates/books.md",
  });
  await openProfileWorkbench(test.app, books.editor);
  expect(books.leaf.container).not.toBe(firstWindow);
  expect(explorer.container).toBe(firstWindow);
  const compact = addEditor(test, { path: test.editor.file!.path });
  await openProfileWorkbench(test.app, compact.editor);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(test.editorLeaf);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(4);
});

it("reopens missing companions for the workbench's own editor without creating a window", async () => {
  const test = setup();
  await openProfileWorkbench(test.app, test.editor);
  const window = test.editorLeaf.container;
  const explorer = test.leaves.find(
    (leaf) => leaf.view.getViewType() === EXPLORER_VIEW_TYPE,
  )!;
  test.leaves.splice(test.leaves.indexOf(explorer), 1);
  await openProfileWorkbench(test.app, test.editor);
  expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3);
  expect(test.leaves.filter((leaf) => leaf.container === window)).toHaveLength(
    3,
  );
});

it("converges simultaneous openings from two editors of the same Profile", async () => {
  const test = setup();
  const compact = addEditor(test, { path: test.editor.file!.path });
  await Promise.all([
    openProfileWorkbench(test.app, test.editor),
    openProfileWorkbench(test.app, compact.editor),
  ]);
  expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(test.editorLeaf);
});

it("promotes a built-in Default workbench through the native leaf when its file is materialized", async () => {
  const test = setup();
  Object.assign(test.editor, {
    file: null,
    isDefaultProfile: true,
    getState: () => ({ itemIndexedKey: "MAIN2345", defaultDraft: true }),
  });
  await openProfileWorkbench(test.app, test.editor);
  const compact = addEditor(test, {
    path: "templates/zotlit-profile.default.md",
    defaultProfile: true,
  });
  await openProfileWorkbench(test.app, compact.editor);
  expect(test.editorLeaf.setViewState).toHaveBeenCalledWith({
    type: PROFILE_EDITOR_VIEW_TYPE,
    state: {
      itemIndexedKey: "MAIN2345",
      defaultDraft: false,
      file: "templates/zotlit-profile.default.md",
    },
  });
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(test.editorLeaf);
});

it("keeps the requested Default workbench and its Item when another full Default workbench comes first", async () => {
  const test = setup();
  const firstContext = { item: { key: "MAIN2345" } };
  Object.assign(test.editor, {
    isDefaultProfile: true,
    authoringContext: firstContext,
  });
  await openProfileWorkbench(test.app, test.editor);
  const later = addEditor(test, {
    container: { focus: vi.fn() },
    path: test.editor.file!.path,
    defaultProfile: true,
  });
  const laterContext = { item: { key: "BOOK2345" } };
  Object.assign(later.editor, { authoringContext: laterContext });
  later.leaf.group = "later-default";
  for (const type of [EXPLORER_VIEW_TYPE, NOTE_PREVIEW_VIEW_TYPE]) {
    const companion = test.makeLeaf(later.leaf.container);
    companion.group = later.leaf.group;
    companion.view = { getViewType: () => type };
  }
  await openProfileWorkbench(test.app, later.editor);
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(later.leaf);
  expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
  expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  expect(test.editor.authoringContext).toBe(firstContext);
  expect(later.editor.authoringContext).toBe(laterContext);
  const preview = test.leaves.find(
    (leaf) =>
      leaf.group === later.leaf.group &&
      leaf.view.getViewType() === NOTE_PREVIEW_VIEW_TYPE,
  )!;
  test.leaves.splice(test.leaves.indexOf(preview), 1);
  await openProfileWorkbench(test.app, later.editor);
  expect(test.workspace.createLeafBySplit).toHaveBeenLastCalledWith(
    later.leaf,
    "vertical",
    false,
  );
  expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(later.leaf);
});
