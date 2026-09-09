import { EditorView } from "@codemirror/view";
import { Menu, TextFileView as MockTextFileView } from "@mock/obsidian";
import type {
  ItemView as MockItemView,
  Scope as MockScope,
} from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import * as m from "@/lib/i18n/generated/messages";

import { ProfileEditorView } from "./view";
import type { ProfileEditorDeps } from "./view";

vi.mock("@/views/note-preview/register", () => ({
  openProfileWorkbench: vi.fn(async () => {}),
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

const SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
---
A stable note.
--- zotlit:annotation ---
An annotation.
`;

class TestProfileEditorView extends ProfileEditorView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

function setup(deps: Partial<ProfileEditorDeps> = {}, sharedApp?: App) {
  const setActiveLeaf = vi.fn();
  const modify = vi.fn<(file: TFile, source: string) => Promise<void>>(
    async () => {},
  );
  const app =
    sharedApp ??
    ({
      scope: null,
      workspace: {
        requestSaveLayout: vi.fn(),
        trigger: vi.fn(),
        on: vi.fn(),
        iterateAllLeaves: vi.fn(),
        setActiveLeaf,
        getActiveFile: () => null,
      },
      loadLocalStorage: () => null,
      vault: { modify },
    } as unknown as App);
  const leaf = {
    app,
    setViewState: vi.fn(async () => {}),
  } as unknown as WorkspaceLeaf;
  const view = new TestProfileEditorView(leaf, {
    app,
    settings: { subscribe: () => () => {} },
    pluginVersion: "2.1.3",
    db: { ready: Promise.resolve(), state: "ready" },
    zoteroPref: { ready: Promise.resolve(), dataDir: null },
    ...deps,
  } as unknown as ProfileEditorDeps);
  leaf.view = view;
  const requestSave = vi.fn();
  view.requestSave = requestSave;
  view.setViewData(SOURCE, true);
  return { view, requestSave, leaf, setActiveLeaf, modify, app };
}

describe("ProfileEditorView", () => {
  it("routes Settings from the current profile identity without selecting an Item", async () => {
    const openSettings = vi.fn<(defaultProfile: boolean) => void>();
    const { view } = setup({ openSettings });
    try {
      await act(async () => view.open());
      await act(async () => view.store.getState().setTab("name"));
      expect(view.store.getState().item).toBeNull();
      const button = [...view.contentEl.querySelectorAll("button")].find(
        (element) => element.textContent === m.workbench_open_settings(),
      )!;
      await act(async () => button.click());
      expect(openSettings).toHaveBeenLastCalledWith(false);
      await act(async () =>
        view.setViewData(SOURCE.replace("id: paper", "id: default"), false),
      );
      await act(async () => button.click());
      expect(openSettings).toHaveBeenLastCalledWith(true);
    } finally {
      await act(async () => view.close());
    }
  });

  it("keeps a file-known Default disabled and routes Settings when opened with invalid source", async () => {
    const openSettings = vi.fn<(defaultProfile: boolean) => void>();
    const path = "templates/zotlit-profile.default.md";
    const { view } = setup({
      openSettings,
      profile: { defaultDocumentPath: path } as ProfileEditorDeps["profile"],
    });
    const file = new TFile();
    file.path = path;
    view.file = file;
    view.setViewData("---\nid: [", true);
    try {
      await act(async () => view.open());
      await act(async () => view.store.getState().setTab("match"));
      expect(view.store.getState().tab).toBe("note");
      const match = [
        ...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ].find((tab) => tab.textContent === m.workbench_tab_match())!;
      expect(match.disabled).toBe(true);
      await act(async () => view.store.getState().setTab("name"));
      const settings = [...view.contentEl.querySelectorAll("button")].find(
        (button) => button.textContent === m.workbench_open_settings(),
      )!;
      await act(async () => settings.click());
      expect(openSettings).toHaveBeenCalledWith(true);
    } finally {
      await act(async () => view.close());
    }
  });

  it("keeps native view actions in sync across edits and document replacement", async () => {
    const { view } = setup();
    await act(async () => view.open());
    const action = (title: string) =>
      (view as unknown as MockItemView).actions.find(
        (element) => element.getAttribute("aria-label") === title,
      )!;
    const undo = action("Undo");
    const redo = action("Redo");
    const source = action("Source");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      view.controller.setManifestKey("name", "Edited");
    });
    expect(undo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => undo.click());
    expect(view.getViewData()).toBe(SOURCE);
    expect(redo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => redo.click());
    expect(view.getViewData()).toContain("name: Edited");
    await act(async () => source.click());
    expect(view.store.getState().advanced).toBe(true);
    expect(source.getAttribute("aria-pressed")).toBe("true");
    await act(async () => view.setViewData(SOURCE, true));
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      view.controller.setManifestKey("name", "Second");
    });
    expect(undo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => undo.click());
    expect(view.getViewData()).toBe(SOURCE);
    await act(async () => view.close());
  });

  it("inspects Default without creation or edits, then binds before native save requests", async () => {
    const file = new TFile();
    file.path = "templates/zotlit-profile.default.md";
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const materializeDefault = vi.fn(() => pending.promise);
    const { view, requestSave } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault,
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState(
      { defaultDraft: true, file: null },
      {} as ViewStateResult,
    );
    const controller = view.controller;
    controller.setManifestKey("name", "Typing attempt");
    expect(controller.undo()).toBe(false);
    expect(controller.redo()).toBe(false);
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).not.toHaveBeenCalled();
    const creating = view.customizeDefault();
    expect(view.store.getState().customization === "pending").toBe(true);
    expect(view.customizeDefault()).toBe(creating);
    expect(materializeDefault).toHaveBeenCalledExactlyOnceWith();
    controller.setManifestKey("name", "Pending attempt");
    pending.resolve({ file, created: true });
    await creating;
    expect(view.controller).toBe(controller);
    expect(controller.readOnly).toBe(false);
    expect(requestSave).not.toHaveBeenCalled();
    controller.dispatch({
      changes: {
        from: 0,
        to: controller.source.length,
        insert: "invalid source",
      },
    });
    expect(view.getViewData()).toBe("invalid source");
    expect(requestSave).toHaveBeenCalledOnce();
    controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
    controller.redo();
    expect(view.getViewData()).toBe("invalid source");
    expect(requestSave).toHaveBeenCalledTimes(3);
  });

  it("keeps values readable after creation failure and retries only at Customize", async () => {
    const file = new TFile();
    const materializeDefault = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValue({ file, created: true });
    const { view, requestSave } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault,
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState({ defaultDraft: true }, {} as ViewStateResult);
    await view.customizeDefault();
    expect(view.store.getState().customization === "failed").toBe(true);
    expect(view.store.getState().customization === "pending").toBe(false);
    view.controller.setManifestKey("name", "Attempt after failure");
    view.controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).toHaveBeenCalledOnce();
    expect(requestSave).not.toHaveBeenCalled();
    await view.customizeDefault();
    expect(view.store.getState().customization === "failed").toBe(false);
    expect(view.isDefaultDraft).toBe(false);
  });

  it("opens competing Default bytes without adding built-in source to Undo", async () => {
    const file = new TFile();
    const { view, leaf, requestSave, modify } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault: async () => ({ file, created: false }),
      } as unknown as ProfileEditorDeps["profile"],
    });
    const existing = SOURCE.replace("name: Paper", "name: Existing Default");
    vi.spyOn(leaf, "setViewState").mockImplementation(async () => {
      view.setViewData(existing, true);
    });
    await view.setState({ defaultDraft: true }, {} as ViewStateResult);
    await view.customizeDefault();
    expect(view.getViewData()).toBe(existing);
    expect(view.controller.undo()).toBe(false);
    expect(requestSave).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
  });

  it("shows read-only source and one inline retry after the Customize action fails", async () => {
    const materializeDefault = vi
      .fn()
      .mockRejectedValue(new Error("Disk full"));
    const { view } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault,
      } as unknown as ProfileEditorDeps["profile"],
    });
    document.body.append(view.contentEl);
    await act(async () => {
      await view.setState({ defaultDraft: true }, {} as ViewStateResult);
      await view.open();
    });
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    );
    expect(editor?.state.readOnly).toBe(true);
    const customize = Array.from(
      view.contentEl.querySelectorAll("button"),
    ).find((button) => button.textContent === m.profile_editor_customize())!;
    await act(async () => {
      customize.click();
      await view.customizeDefault();
    });
    expect(view.contentEl.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.contentEl.textContent).toContain(
      m.settings_citation_engine_retry(),
    );
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).toHaveBeenCalledOnce();
    await act(async () => view.close());
    view.contentEl.remove();
  });

  it("keeps a newly opened Profile when Default creation finishes", async () => {
    const file = new TFile();
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const { view, modify } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault: () => pending.promise,
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState({ defaultDraft: true }, {} as ViewStateResult);
    const creating = view.customizeDefault();
    await view.setState({ file: "other.md" }, {} as ViewStateResult);
    view.setViewData(SOURCE.replace("name: Paper", "name: Other"), true);
    const controller = view.controller;
    pending.resolve({ file, created: true });
    await creating;
    expect(view.controller).toBe(controller);
    expect(view.getViewData()).toContain("name: Other");
    expect(modify).not.toHaveBeenCalled();
  });
  it("keeps authoring and restored state available when the database fails", async () => {
    const { view, requestSave } = setup({
      db: {
        get ready() {
          return Promise.reject(new Error("Unavailable"));
        },
      } as unknown as ProfileEditorDeps["db"],
    });
    await expect(
      view.setState(
        { itemIndexedKey: "0:ABCDEFGH", advanced: true },
        {} as ViewStateResult,
      ),
    ).resolves.toBeUndefined();
    expect(view.store.getState().advanced).toBe(true);
    expect(view.unavailableDependencies).toHaveLength(1);
    view.controller.setManifestKey("name", "Offline edit");
    expect(view.getViewData()).toContain("Offline edit");
    expect(requestSave).toHaveBeenCalledOnce();
  });

  it("clears the unavailable citation styles status after recovery", async () => {
    let failed = true;
    const { view } = setup({
      zoteroPref: {
        get ready() {
          return failed
            ? Promise.reject(new Error("Unavailable"))
            : Promise.resolve();
        },
      } as unknown as ProfileEditorDeps["zoteroPref"],
    });
    await expect(view.refreshStyles()).resolves.toBeUndefined();
    expect(view.unavailableDependencies).toHaveLength(1);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.citationStyles).toEqual([]);
    failed = false;
    await view.refreshStyles();
    expect(view.unavailableDependencies).toEqual([]);
  });

  it("routes the view shortcut to shared history while leaving text inputs their own shortcut", () => {
    const { view } = setup();
    view.controller.setManifestKey("name", "Local");
    const scope = view.scope as unknown as MockScope;
    const undo = scope.handlers.find(
      (handler) => handler.key === "z" && handler.modifiers?.length === 1,
    )!;
    const input = document.createElement("input");
    const typing = new KeyboardEvent("keydown", { key: "z" });
    input.dispatchEvent(typing);
    expect(undo.func(typing)).toBeUndefined();
    expect(view.controller.canUndo).toBe(true);
    expect(undo.func(new KeyboardEvent("keydown", { key: "z" }))).toBe(false);
    expect(view.getViewData()).toBe(SOURCE);
  });

  it("requests the normal save path for an invalid local edit", () => {
    const { view, requestSave } = setup();
    view.controller.dispatch({
      changes: {
        from: 0,
        to: view.controller.state.doc.length,
        insert: "---\nname: [unfinished",
      },
    });
    expect(requestSave).toHaveBeenCalledOnce();
    expect(view.getViewData()).toBe("---\nname: [unfinished");
    expect(view.controller.document).toBeNull();
  });

  it("reconciles external text once, retains the controller, and does not echo a save", () => {
    const { view, requestSave } = setup();
    const controller = view.controller;
    controller.setManifestKey("name", "Local");
    const local = view.getViewData();
    requestSave.mockClear();
    const update = vi.fn();
    controller.subscribe(update);
    view.setViewData(local.replace("A stable note.", "Agent text."), false);
    expect(view.controller).toBe(controller);
    expect(update).toHaveBeenCalledOnce();
    expect(requestSave).not.toHaveBeenCalled();
    controller.undo();
    expect(view.getViewData()).toBe(local);
    expect(requestSave).toHaveBeenCalledOnce();
    controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
  });

  it("starts a new history when another file loads", () => {
    const { view } = setup();
    const before = view.controller;
    before.setManifestKey("name", "Edited");
    view.setViewData(SOURCE.replace("name: Paper", "name: Other"), true);
    expect(view.controller).not.toBe(before);
    expect(view.controller.canUndo).toBe(false);
  });

  it("restores authoring and Explorer state beside the file path", async () => {
    const { view } = setup();
    const file = new TFile();
    file.path = "templates/paper.md";
    view.file = file;
    const state = {
      file: file.path,
      tab: "annotation",
      root: "annotation",
      explorer: "all",
      advanced: true,
      preview: { mode: "update", live: false },
    };
    await view.setState(state, {} as ViewStateResult);
    expect(view.getState()).toEqual({ ...state, itemIndexedKey: null });
  });
  it("labels a built-in annotation sample export as selected paper data", () => {
    const { view } = setup();
    view.store.getState().setItem({ id: "PAPER001g42", title: "Paper" });
    view.store.getState().setRoot("annotation");
    Object.defineProperty(view, "preview", {
      value: {
        state: createStore(() => ({
          current: [],
          example: { id: "builtin", root: { indexedKey: "EXAMP001" } },
        })),
      },
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    expect(view.templateDataTarget()).toEqual({
      indexedKey: "PAPER001g42",
      root: "note",
    });
    expect(menu.items[0]?.title).toBe("Export selected paper data");
  });

  it("keeps a real selected annotation export on its exact Indexed Key", () => {
    const { view } = setup();
    view.store.getState().setItem({ id: "PAPER001g42", title: "Paper" });
    view.store.getState().setRoot("annotation");
    const annotation = { id: "real", root: { indexedKey: "ANNO0001g42" } };
    Object.defineProperty(view, "preview", {
      value: {
        state: createStore(() => ({
          current: [annotation],
          example: annotation,
        })),
      },
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    expect(view.templateDataTarget()).toEqual({
      indexedKey: "ANNO0001g42",
      root: "annotation",
    });
    expect(menu.items[0]?.title).toBe("Save template data as JSON");
  });
  it("inserts at the remembered slice selection and returns focus after sidebar use", async () => {
    const { view, leaf, requestSave, setActiveLeaf } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      const sidebar = document.createElement("button");
      document.body.append(sidebar);
      await act(() => sidebar.focus());
      expect(editor.hasFocus).toBe(false);
      await act(() => {
        expect(view.insertField("{{ zt.title }}")).toBe(true);
      });
      expect(view.getViewData()).toBe(
        SOURCE.replace("A stable note.", "A s{{ zt.title }}table note."),
      );
      expect(editor.hasFocus).toBe(true);
      expect(setActiveLeaf).toHaveBeenCalledWith(leaf, {
        focus: false,
      });
      expect(requestSave).toHaveBeenCalledOnce();
      await act(() => {
        view.controller.undo();
      });
      expect(view.getViewData()).toBe(SOURCE);
      sidebar.remove();
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });

  it("keeps the caret target mapped when external text moves an unchanged focused slice", async () => {
    const { view } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      const external = SOURCE.replace(
        "name: Paper",
        "name: A considerably longer title",
      );
      await act(() => {
        view.setViewData(external, false);
      });
      expect(editor.hasFocus).toBe(true);
      await act(() => {
        view.insertField("{{ zt.title }}");
      });
      expect(view.getViewData()).toBe(
        external.replace("A stable note.", "A s{{ zt.title }}table note."),
      );
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });
  it("rejects insertion after the remembered filename slice is removed", async () => {
    const { view } = setup();
    view.store.getState().setTab("name");
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 2 } });
      });
      expect(view.insertTarget?.slice).toBe("filename");
      const external = SOURCE.replace("filename: paper\n", "");
      await act(() => {
        view.setViewData(external, false);
      });
      await act(() => {
        expect(view.insertField("{{ zt.title }}")).toBe(false);
      });
      expect(view.getViewData()).toBe(external);
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });
});

function sharedWorkspace() {
  const setActiveLeaf = vi.fn();
  const listeners = new Set<(file: TFile, source: string) => void>();
  const leaves: WorkspaceLeaf[] = [];
  const read = vi.fn<(file: TFile) => Promise<string>>(async () => SOURCE);
  const trigger = vi.fn((name: string, file: TFile, source: string) => {
    if (name === "quick-preview")
      for (const listener of listeners) listener(file, source);
  });
  const app = {
    scope: null,
    workspace: {
      requestSaveLayout: vi.fn(),
      setActiveLeaf,
      on(name: string, callback: (file: TFile, source: string) => void) {
        if (name === "quick-preview") listeners.add(callback);
      },
      trigger,
      iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void) {
        leaves.forEach(callback);
      },
    },
    loadLocalStorage: () => null,
    vault: { read },
  } as unknown as App;
  const file = new TFile();
  file.path = "profiles/paper.md";
  function editor() {
    const result = setup({}, app);
    result.view.file = file;
    result.view.lastSavedData = SOURCE;
    leaves.push(result.leaf);
    return result;
  }
  return { app, file, read, trigger, editor, setActiveLeaf };
}

describe("native Profile source exchange", () => {
  it("exchanges one event per edit and keeps controllers, context, selection and history independent", () => {
    const { editor, trigger, setActiveLeaf } = sharedWorkspace();
    const first = editor();
    const second = editor();
    const firstController = first.view.controller;
    const secondController = second.view.controller;
    first.view.store.getState().setItem({ id: "AAAA0001", title: "First" });
    second.view.store.getState().setItem({ id: "BBBB0002", title: "Second" });
    second.view.store.getState().setAdvanced(true);
    const cursor = SOURCE.indexOf("stable") + 2;
    secondController.dispatch({ selection: { anchor: cursor } });
    firstController.setManifestKey("name", "Longer name");
    const edited = SOURCE.replace("name: Paper", "name: Longer name");
    expect(second.view.getViewData()).toBe(edited);
    expect(secondController.state.selection.main.head).toBe(cursor + 6);
    expect(
      trigger.mock.calls.filter(([name]) => name === "quick-preview"),
    ).toHaveLength(1);
    expect(first.requestSave).toHaveBeenCalledTimes(1);
    expect(second.requestSave).not.toHaveBeenCalled();
    expect(second.view.dirty).toBe(true);
    expect(first.view.controller).toBe(firstController);
    expect(second.view.controller).toBe(secondController);
    expect(secondController).not.toBe(firstController);
    expect(first.view.store.getState().item?.id).toBe("AAAA0001");
    expect(second.view.store.getState().item?.id).toBe("BBBB0002");
    expect(second.view.store.getState().advanced).toBe(true);
    expect(first.view.store.getState().advanced).toBe(false);
    expect(secondController.undo()).toBe(true);
    expect(first.view.getViewData()).toBe(SOURCE);
    expect(second.view.getViewData()).toBe(SOURCE);
    expect(secondController.redo()).toBe(true);
    expect(first.view.getViewData()).toBe(edited);
    expect(setActiveLeaf).not.toHaveBeenCalled();
  });

  it("accepts invalid native source, ignores same-path foreign identities and equal events", () => {
    const { editor, app, file } = sharedWorkspace();
    const { view, requestSave } = editor();
    const foreign = new TFile();
    foreign.path = file.path;
    app.workspace.trigger("quick-preview", foreign, "unrelated");
    expect(view.getViewData()).toBe(SOURCE);
    app.workspace.trigger("quick-preview", file, "---\nname: [unfinished");
    app.workspace.trigger("quick-preview", file, "---\nname: [unfinished");
    expect(view.controller.document).toBeNull();
    expect(view.getViewData()).toBe("---\nname: [unfinished");
    expect(requestSave).not.toHaveBeenCalled();
    expect(view.controller.undo()).toBe(true);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.controller.undo()).toBe(false);
  });

  it("initializes from a current peer after the last edit, retaining the native disk baseline", async () => {
    const { editor, read } = sharedWorkspace();
    const first = editor();
    first.view.controller.setManifestKey("name", "Unsaved");
    const second = editor();
    await second.view.loadFileInternal(second.view.file!, true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second.view.getViewData()).toBe(
      SOURCE.replace("name: Paper", "name: Unsaved"),
    );
    expect(second.view.lastSavedData).toBe(SOURCE);
    expect(second.view.controller.canUndo).toBe(false);
    expect(second.requestSave).not.toHaveBeenCalled();
  });

  it("retains source received during initial disk loading without adding an initial Undo entry", async () => {
    const { editor, read, app, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, true);
    app.workspace.trigger(
      "quick-preview",
      file,
      "Current native Markdown source",
    );
    pending.resolve(SOURCE);
    await loading;
    expect(view.getViewData()).toBe("Current native Markdown source");
    expect(view.lastSavedData).toBe(SOURCE);
    expect(view.controller.canUndo).toBe(false);
  });

  it("rejects a delayed read before baseline mutation after live input and a completed save", async () => {
    const { editor, read, app, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, false);
    const saved = SOURCE.replace("A stable note.", "Current saved note.");
    app.workspace.trigger("quick-preview", file, saved);
    // A native save completes while the older read is waiting.
    view.lastSavedData = saved;
    view.dirty = false;
    read.mockResolvedValue(saved);
    pending.resolve("Stale disk text");
    await loading;
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.lastSavedData).toBe(saved);
    expect(view.getViewData()).toBe(saved);
    expect(view.controller.undo()).toBe(true);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.controller.undo()).toBe(false);
  });

  it("does not let an older read supersede a newer read or a rebound file", async () => {
    const { editor, read, file } = sharedWorkspace();
    const { view } = editor();
    const old = Promise.withResolvers<string>();
    read
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce("New disk text");
    const older = view.loadFileInternal(file, false);
    await view.loadFileInternal(file, false);
    old.resolve("Old disk text");
    await older;
    expect(view.getViewData()).toBe("New disk text");
    expect(view.lastSavedData).toBe("New disk text");
    expect(read).toHaveBeenCalledTimes(2);
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const previousFile = view.loadFileInternal(file, false);
    view.file = new TFile();
    view.setViewData("Other document", true);
    view.lastSavedData = "Other document";
    pending.resolve("Previous document");
    await previousFile;
    expect(view.getViewData()).toBe("Other document");
    expect(view.lastSavedData).toBe("Other document");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("lets native close read the final source and ignores a read that completes after closing", async () => {
    const { editor, read, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, false);
    view.controller.setManifestKey("name", "Final edit");
    let closingSource = "";
    using _nativeClose = vi
      .spyOn(
        MockTextFileView.prototype as unknown as { onClose(): Promise<void> },
        "onClose",
      )
      .mockImplementation(async () => {
        closingSource = view.getViewData();
      });
    await view.close();
    pending.resolve("Old file");
    await loading;
    expect(closingSource).toBe(
      SOURCE.replace("name: Paper", "name: Final edit"),
    );
    expect(view.lastSavedData).toBe(SOURCE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("clears a view without publishing empty source into its peers", () => {
    const { editor, trigger } = sharedWorkspace();
    const first = editor();
    const second = editor();
    first.view.clear();
    expect(first.view.getViewData()).toBe("");
    expect(second.view.getViewData()).toBe(SOURCE);
    expect(
      trigger.mock.calls.filter(([name]) => name === "quick-preview"),
    ).toHaveLength(0);
  });
});
