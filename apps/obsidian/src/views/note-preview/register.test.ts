import { it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Scope } from "effect";
import type { App, Command, Plugin, WorkspaceLeaf, ItemView } from "obsidian";
import { describe, expect, onTestFinished, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { makeWorkspace, Workspace } from "@/lib/obsidian-workspace";
import type { WorkspaceSource } from "@/lib/obsidian-workspace";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";
import { workbenchActionContext } from "@/views/template-workbench/__fixtures__";
import type { WorkbenchActionDeps } from "@/views/template-workbench/actions";
import {
  TemplateWorkbenchView,
  TEMPLATE_WORKBENCH_VIEW_TYPE,
} from "@/views/template-workbench/view";
import type { TemplateWorkbenchDeps } from "@/views/template-workbench/view";

import { openNotePreview, openWorkbenchLayout } from "./layout";
import {
  activeTemplateWorkbench,
  registerNotePreview,
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveTemplateWorkbench,
} from "./register";
import { NOTE_PREVIEW_VIEW_TYPE } from "./view";
import type { PreviewViewDeps } from "./view";

const emptyWorkbenchDeps = stubService<TemplateWorkbenchDeps>(
  "TemplateWorkbenchDeps",
  {},
);

vi.mock("@/views/template-workbench/view", async () => {
  const { createStore } = await import("zustand/vanilla");
  let nextProfile = 0;
  return {
    TEMPLATE_WORKBENCH_VIEW_TYPE: "zotlit-template-workbench",
    TemplateWorkbenchView: class {
      constructor(readonly leaf: WorkspaceLeaf) {}
      file = { path: `templates/profile-${++nextProfile}.md` };
      isDefaultProfile = false;
      store = createStore(() => ({ explorer: "simple" }));
      onResize = vi.fn();
      getViewType() {
        return "zotlit-template-workbench";
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
  const commands = new Map<string, Command>();
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
  const app = stubService<App>("App", {
    workspace: workspace as unknown as App["workspace"],
  });
  const plugin = stubService<Plugin>("Plugin", {
    app,
    manifest: stubService<Plugin["manifest"]>("PluginManifest", {
      id: "zotlit",
    }),
    registerView: vi.fn(),
    registerEvent: vi.fn(),
    addCommand: (command) => {
      commands.set(command.id, command);
      return command;
    },
    register: (dispose: () => void) => cleanup.push(dispose),
  });
  const bridge = openTestBridge();
  onTestFinished(() => bridge[Symbol.asyncDispose]());
  // The Workspace tag over this workspace, for the layout opens.
  const scope = Scope.makeUnsafe();
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const workspaceTag = Effect.runSync(
    makeWorkspace(workspace as unknown as WorkspaceSource).pipe(
      Scope.provide(scope),
    ),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) =>
    Effect.provideService(effect, Workspace, workspaceTag);
  registerNotePreview(
    plugin,
    stubService<PreviewViewDeps & WorkbenchActionDeps>("PreviewViewDeps", {
      bridge,
      context: workbenchActionContext(testNotifier().service).pipe(
        Context.add(Workspace, workspaceTag),
      ),
    }),
  );
  const editorLeaf = makeLeaf();
  const editor = new TemplateWorkbenchView(
    editorLeaf as unknown as WorkspaceLeaf,
    emptyWorkbenchDeps,
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
    run,
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
  const editor = new TemplateWorkbenchView(
    leaf as unknown as WorkspaceLeaf,
    emptyWorkbenchDeps,
  );
  Object.assign(editor, {
    file: options.path === null ? null : { path: options.path },
    isDefaultProfile: options.defaultProfile ?? false,
  });
  leaf.view = editor;
  return { editor, leaf };
}

describe("active Template Workbench sidebars", () => {
  it("removes a subscription whose initial binding fails", () => {
    const test = setup();
    const listener = vi.fn<() => void>(() => {
      throw new Error("Binding unavailable");
    });
    expect(() => subscribeActiveTemplateWorkbench(test.app, listener)).toThrow(
      "Binding unavailable",
    );
    listener.mockImplementation(() => {});
    test.activate(test.editor);
    expect(listener).toHaveBeenCalledOnce();
    for (const dispose of test.cleanup) dispose();
  });

  it("follows each editor, retains it in its sidebar, and clears when the editor closes", async () => {
    const test = setup();
    const seen: (TemplateWorkbenchView | null)[] = [];
    const unsubscribe = subscribeActiveTemplateWorkbench(test.app, (editor) =>
      seen.push(editor),
    );
    test.activate(test.editor);
    expect(activeTemplateWorkbench(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => NOTE_PREVIEW_VIEW_TYPE });
    expect(activeTemplateWorkbench(test.app)).toBe(test.editor);
    test.activate({ getViewType: () => EXPLORER_VIEW_TYPE });
    expect(activeTemplateWorkbench(test.app)).toBe(test.editor);
    test.leaves.splice(0, 1);
    test.callbacks.get("layout-change")?.();
    expect(activeTemplateWorkbench(test.app)).toBeNull();
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
      TEMPLATE_WORKBENCH_VIEW_TYPE,
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
    const seen: (TemplateWorkbenchView | null)[] = [];
    subscribeActiveTemplateWorkbench(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    test.activate({ getViewType: () => "markdown" });
    expect(seen).toEqual([test.editor, null]);
  });

  it.effect(
    "moves the same editor into three columns only on explicit action and reuses its window",
    () =>
      Effect.gen(function* () {
        const test = setup();
        test.activate(test.editor);
        yield* test.run(
          Effect.all(
            [
              openWorkbenchLayout(test.editor),
              openWorkbenchLayout(test.editor),
            ],
            { concurrency: "unbounded" },
          ),
        );
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
          TEMPLATE_WORKBENCH_VIEW_TYPE,
          EXPLORER_VIEW_TYPE,
          NOTE_PREVIEW_VIEW_TYPE,
        ]);
        expect(
          test.leaves.every(
            (leaf) => leaf.container === test.editorLeaf.container,
          ),
        ).toBe(true);
        yield* test.run(openWorkbenchLayout(test.editor));
        expect(test.workspace.moveLeafToPopout).toHaveBeenCalledOnce();
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(test.editorLeaf.container.focus).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect("loads a deferred saved workbench before reusing its window", () =>
    Effect.gen(function* () {
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
        getViewType: () => TEMPLATE_WORKBENCH_VIEW_TYPE,
        getState: () => ({ file: test.editor.file!.path }),
      };
      const load = vi.fn(async () => {
        restored.leaf.view = restored.editor;
      });
      Object.assign(restored.leaf, { loadIfDeferred: load });
      yield* test.run(openWorkbenchLayout(test.editor));
      expect(load).toHaveBeenCalledOnce();
      expect(test.workspace.revealLeaf).toHaveBeenCalledWith(restored.leaf);
      expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
      expect(test.workspace.createLeafBySplit).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "moves the requested editor when another compact editor has the same Profile",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const compact = addEditor(test, {
          container: { focus: vi.fn() },
          path: test.editor.file!.path,
        });
        yield* test.run(openWorkbenchLayout(test.editor));
        expect(test.workspace.moveLeafToPopout).toHaveBeenCalledWith(
          test.editorLeaf,
          { size: { width: 1440, height: 900 } },
        );
        expect(test.workspace.revealLeaf).toHaveBeenCalledWith(test.editorLeaf);
        expect(compact.leaf.group).toBeNull();
      }),
  );

  it.effect(
    "moves an editor out of a window with unrelated unlinked companions",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const original = { focus: vi.fn() };
        test.editorLeaf.container = original;
        const pinned = test.makeLeaf(original);
        pinned.pinned = true;
        pinned.view = {
          getViewType: () => NOTE_PREVIEW_VIEW_TYPE,
          getState: () => ({ source: { path: "templates/other.md" } }),
        };
        yield* test.run(openWorkbenchLayout(test.editor));
        expect(test.editorLeaf.container).not.toBe(original);
        expect(pinned.container).toBe(original);
        expect(pinned.group).toBeNull();
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    "adds companions in the existing native window of a popout editor",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const ordinary = { focus: vi.fn() };
        test.editorLeaf.container = ordinary;
        test.activate(test.editor);
        yield* test.run(openWorkbenchLayout(test.editor));
        expect(test.workspace.moveLeafToPopout).not.toHaveBeenCalled();
        expect(test.editorLeaf.container).toBe(ordinary);
        expect(test.leaves.every((leaf) => leaf.container === ordinary)).toBe(
          true,
        );
      }),
  );

  it.effect(
    "keeps a closed preview closed until its reopen command runs in the workbench window",
    () =>
      Effect.gen(function* () {
        const test = setup();
        test.activate(test.editor);
        yield* test.run(openWorkbenchLayout(test.editor));
        test.leaves.splice(2, 1);
        test.callbacks.get("layout-change")?.();
        test.activate(test.editor);
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
        const command = test.commands.get("open-note-preview")!;
        expect(command.checkCallback!(true)).toBe(true);
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
        command.checkCallback!(false);
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3),
          ),
        );
        expect(test.leaves[2]!.getContainer()).toBe(
          test.editorLeaf.getContainer(),
        );
        yield* test.run(openNotePreview(test.editor));
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3);
      }),
  );

  it.effect("binds companion views to their native group across windows", () =>
    Effect.gen(function* () {
      const test = setup();
      test.activate(test.editor);
      yield* test.run(openWorkbenchLayout(test.editor));
      const companion = test.leaves[1]!;
      const seen: (TemplateWorkbenchView | null)[] = [];
      subscribeActiveTemplateWorkbench(
        test.app,
        (editor) => seen.push(editor),
        companion as unknown as WorkspaceLeaf,
      );
      const otherLeaf = test.makeLeaf();
      const other = new TemplateWorkbenchView(
        otherLeaf as unknown as WorkspaceLeaf,
        emptyWorkbenchDeps,
      );
      otherLeaf.view = other;
      test.activate(other);
      expect(activeTemplateWorkbench(test.app)).toBe(other);
      expect(seen).toEqual([test.editor]);
      test.activate(companion.view);
      expect(activeTemplateWorkbench(test.app)).toBe(test.editor);
      test.leaves.splice(2, 1);
      test.commands.get("open-note-preview")!.checkCallback!(false);
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3),
        ),
      );
      expect(test.workspace.createLeafBySplit).toHaveBeenLastCalledWith(
        test.editorLeaf,
        "vertical",
        false,
      );
    }),
  );
  it("uses native group order across windows and detects peers joining and closing", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    const companion = test.makeLeaf({ focus: vi.fn() });
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.group = "research";
    const seen: (TemplateWorkbenchView | null)[] = [];
    const dispose = subscribeActiveTemplateWorkbench(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    cleanup.defer(dispose);
    expect(seen).toEqual([null]);
    const secondLeaf = test.makeLeaf();
    const second = new TemplateWorkbenchView(
      secondLeaf as unknown as WorkspaceLeaf,
      emptyWorkbenchDeps,
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
    const other = new TemplateWorkbenchView(
      otherLeaf as unknown as WorkspaceLeaf,
      emptyWorkbenchDeps,
    );
    otherLeaf.view = other;
    test.activate(other);
    expect(
      activeTemplateWorkbench(test.app, companion as unknown as WorkspaceLeaf),
    ).toBe(test.editor);
    companion.group = "empty-group";
    expect(
      activeTemplateWorkbench(test.app, companion as unknown as WorkspaceLeaf),
    ).toBeNull();
    companion.group = null;
    expect(
      activeTemplateWorkbench(test.app, companion as unknown as WorkspaceLeaf),
    ).toBe(other);
  });

  it("holds an unlinked pinned editor and follows the current file after unpin", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    test.activate(test.editor);
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    const seen: (TemplateWorkbenchView | null)[] = [];
    const dispose = subscribeActiveTemplateWorkbench(
      test.app,
      (editor) => seen.push(editor),
      companion as unknown as WorkspaceLeaf,
    );
    cleanup.defer(dispose);
    companion.pinned = true;
    companion.trigger("pinned-change");
    const otherLeaf = test.makeLeaf({ focus: vi.fn() });
    const other = new TemplateWorkbenchView(
      otherLeaf as unknown as WorkspaceLeaf,
      emptyWorkbenchDeps,
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
    const seen: (TemplateWorkbenchView | null)[] = [];
    const dispose = subscribeActiveTemplateWorkbench(
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

  it.effect(
    "preserves an editor's existing native group on move and reuses its cross-window companions",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const preview = test.makeLeaf();
        preview.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
        preview.setGroupMember(test.editorLeaf);
        const group = test.editorLeaf.group;
        const resize = vi.spyOn(test.editor, "onResize");
        yield* test.run(openWorkbenchLayout(test.editor));
        expect(test.editorLeaf.group).toBe(group);
        expect(preview.group).toBe(group);
        expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(1);
        expect(test.leaves.every((leaf) => leaf.group === group)).toBe(true);
        expect(resize).toHaveBeenCalledOnce();
      }),
  );
  it("reports an earlier native group peer while pinned and repeats its binding on unpin", () => {
    using cleanup = new DisposableStack();
    const test = setup();
    const companion = test.makeLeaf();
    companion.view = { getViewType: () => NOTE_PREVIEW_VIEW_TYPE };
    companion.pinned = true;
    const heldLeaf = test.makeLeaf();
    const held = new TemplateWorkbenchView(
      heldLeaf as unknown as WorkspaceLeaf,
      emptyWorkbenchDeps,
    );
    heldLeaf.view = held;
    companion.setGroupMember(heldLeaf);
    const seen: (TemplateWorkbenchView | null)[] = [];
    cleanup.defer(
      subscribeActiveTemplateWorkbench(
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
  const view = stubService<ItemView>("ItemView", {});
  Object.defineProperty(view, "navigation", { value: false, writable: true });
  const history: { owner: WorkspaceLeaf | null } = { owner: null };
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
    view,
    recordHistory(this: WorkspaceLeaf, state: unknown) {
      if (!this.view.navigation) return;
      expect(leaf.view.navigation).toBe(false);
      expect(history.owner).toBe(leaf);
      snapshots.push(state);
    },
  });
  Object.defineProperty(leaf, "history", { value: history });
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
  const replacement = stubService<ItemView>("ItemView", {});
  Object.defineProperty(replacement, "navigation", {
    value: false,
    writable: true,
  });
  leaf.view = replacement;
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
  const stop = subscribeActiveTemplateWorkbench(test.app, listener);
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
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      onLayoutReady(callback: () => void) {
        ready = callback;
      },
    }),
  });
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

it.effect(
  "reveals an existing file-backed Default workbench for a compact built-in Default without adding columns",
  () =>
    Effect.gen(function* () {
      const test = setup();
      Object.assign(test.editor, {
        file: { path: "templates/zotlit-profile.default.md" },
        isDefaultProfile: true,
      });
      yield* test.run(openWorkbenchLayout(test.editor));
      const window = test.editorLeaf.container;
      const compact = addEditor(test, {
        container: { focus: vi.fn() },
        path: null,
        defaultProfile: true,
      });
      yield* test.run(openWorkbenchLayout(compact.editor));
      expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(
        test.editorLeaf,
      );
      expect(test.workspace.setActiveLeaf).toHaveBeenLastCalledWith(
        test.editorLeaf,
        { focus: true },
      );
      expect(window.focus).toHaveBeenCalledTimes(2);
      expect(compact.leaf.container).not.toBe(window);
    }),
);

it.effect(
  "moves another Profile's compact editor out of an existing workbench window and reuses its new workbench",
  () =>
    Effect.gen(function* () {
      const test = setup();
      yield* test.run(openWorkbenchLayout(test.editor));
      const firstWindow = test.editorLeaf.container;
      const originalLeaves = [...test.leaves];
      const books = addEditor(test, {
        container: firstWindow,
        path: "templates/books.md",
      });
      const historyOwner = books.editor;
      yield* test.run(openWorkbenchLayout(books.editor));
      expect(test.workspace.moveLeafToPopout).toHaveBeenLastCalledWith(
        books.leaf,
        {
          size: { width: 1440, height: 900 },
        },
      );
      expect(books.leaf.view).toBe(historyOwner);
      expect(books.leaf.container).not.toBe(firstWindow);
      expect(
        originalLeaves.every((leaf) => leaf.container === firstWindow),
      ).toBe(true);
      expect(
        test.leaves.filter((leaf) => leaf.container === firstWindow),
      ).toHaveLength(3);
      expect(
        test.leaves.filter((leaf) => leaf.container === books.leaf.container),
      ).toHaveLength(3);
      expect(books.leaf.group).not.toBe(test.editorLeaf.group);
      const compact = addEditor(test, { path: "templates/books.md" });
      yield* test.run(openWorkbenchLayout(compact.editor));
      expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(2);
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(4);
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(books.leaf);
    }),
);

it.effect(
  "keeps an unlinked or partially closed workbench window occupied when another Profile opens",
  () =>
    Effect.gen(function* () {
      const test = setup();
      yield* test.run(openWorkbenchLayout(test.editor));
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
      yield* test.run(openWorkbenchLayout(books.editor));
      expect(books.leaf.container).not.toBe(firstWindow);
      expect(explorer.container).toBe(firstWindow);
      const compact = addEditor(test, { path: test.editor.file!.path });
      yield* test.run(openWorkbenchLayout(compact.editor));
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(
        test.editorLeaf,
      );
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(4);
    }),
);

it.effect(
  "reopens missing companions for the workbench's own editor without creating a window",
  () =>
    Effect.gen(function* () {
      const test = setup();
      yield* test.run(openWorkbenchLayout(test.editor));
      const window = test.editorLeaf.container;
      const explorer = test.leaves.find(
        (leaf) => leaf.view.getViewType() === EXPLORER_VIEW_TYPE,
      )!;
      test.leaves.splice(test.leaves.indexOf(explorer), 1);
      yield* test.run(openWorkbenchLayout(test.editor));
      expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(3);
      expect(
        test.leaves.filter((leaf) => leaf.container === window),
      ).toHaveLength(3);
    }),
);

it.effect("opens one Note Preview when two opens run at once", () =>
  Effect.gen(function* () {
    const test = setup();
    // The new pane takes its view only once Obsidian has loaded it.
    const loaded = Promise.withResolvers<void>();
    test.workspace.createLeafBySplit.mockImplementation((leaf) => {
      const created = test.makeLeaf(leaf.container);
      created.setViewState = vi.fn(async ({ type }: { type: string }) => {
        await loaded.promise;
        created.view = { getViewType: () => type, getState: () => ({}) };
      });
      return created;
    });
    const opens = yield* Effect.forkChild(
      test.run(
        Effect.all(
          [openNotePreview(test.editor), openNotePreview(test.editor)],
          { concurrency: "unbounded" },
        ),
      ),
    );
    yield* Effect.promise(() =>
      vi.waitFor(() =>
        expect(test.workspace.createLeafBySplit).toHaveBeenCalled(),
      ),
    );
    loaded.resolve();
    yield* Fiber.join(opens);
    expect(test.workspace.createLeafBySplit).toHaveBeenCalledOnce();
    expect(
      test.leaves.filter(
        (leaf) => leaf.view.getViewType() === NOTE_PREVIEW_VIEW_TYPE,
      ),
    ).toHaveLength(1);
  }),
);

it.effect(
  "converges simultaneous openings from two editors of the same Profile",
  () =>
    Effect.gen(function* () {
      const test = setup();
      const compact = addEditor(test, { path: test.editor.file!.path });
      yield* test.run(
        Effect.all(
          [
            openWorkbenchLayout(test.editor),
            openWorkbenchLayout(compact.editor),
          ],
          { concurrency: "unbounded" },
        ),
      );
      expect(test.workspace.moveLeafToPopout).toHaveBeenCalledTimes(1);
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(
        test.editorLeaf,
      );
    }),
);

it.effect(
  "promotes a built-in Default workbench through the native leaf when its file is materialized",
  () =>
    Effect.gen(function* () {
      const test = setup();
      Object.assign(test.editor, {
        file: null,
        isDefaultProfile: true,
        getState: () => ({ itemIndexedKey: "MAIN2345", defaultDraft: true }),
      });
      yield* test.run(openWorkbenchLayout(test.editor));
      const compact = addEditor(test, {
        path: "templates/zotlit-profile.default.md",
        defaultProfile: true,
      });
      yield* test.run(openWorkbenchLayout(compact.editor));
      expect(test.editorLeaf.setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: {
          itemIndexedKey: "MAIN2345",
          defaultDraft: false,
          file: "templates/zotlit-profile.default.md",
        },
      });
      expect(test.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(
        test.editorLeaf,
      );
    }),
);

it.effect(
  "keeps the requested Default workbench and its Item when another full Default workbench comes first",
  () =>
    Effect.gen(function* () {
      const test = setup();
      const firstContext = { item: { key: "MAIN2345" } };
      Object.assign(test.editor, {
        isDefaultProfile: true,
        authoringContext: firstContext,
      });
      yield* test.run(openWorkbenchLayout(test.editor));
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
      yield* test.run(openWorkbenchLayout(later.editor));
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
      yield* test.run(openWorkbenchLayout(later.editor));
      expect(test.workspace.createLeafBySplit).toHaveBeenLastCalledWith(
        later.leaf,
        "vertical",
        false,
      );
      expect(test.workspace.revealLeaf).toHaveBeenLastCalledWith(later.leaf);
    }),
);
