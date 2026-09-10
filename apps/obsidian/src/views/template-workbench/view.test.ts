import { EditorView } from "@codemirror/view";
import { Menu, Notice, TextFileView as MockTextFileView } from "@mock/obsidian";
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

import { createSharedPartial } from "./new-partial";
import { TemplateWorkbenchView } from "./view";
import type { TemplateWorkbenchDeps } from "./view";

vi.mock("@/views/note-preview/register", () => ({
  openWorkbenchLayout: vi.fn(async () => {}),
}));

// The create flow is #1046's own, driven end to end by new-partial.test.ts.
// Here it stands in, so a right-click reports the source and the language it
// was handed and the extraction's own edit is what the assertions read.
vi.mock("./new-partial", () => ({
  createSharedPartial: vi.fn(async () => null),
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

class TestTemplateWorkbenchView extends TemplateWorkbenchView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

function setup(deps: Partial<TemplateWorkbenchDeps> = {}, sharedApp?: App) {
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
        on: vi.fn(() => ({})),
        offref: vi.fn(),
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
  const view = new TestTemplateWorkbenchView(leaf, {
    app,
    settings: { subscribe: () => () => {} },
    pluginVersion: "2.1.3",
    db: { ready: Promise.resolve(), state: "ready" },
    zoteroPref: { ready: Promise.resolve(), dataDir: null },
    templates: {
      loaded: true,
      getPartialNames: () => [],
      getPartialDocuments: () => [],
    },
    ...deps,
  } as unknown as TemplateWorkbenchDeps);
  leaf.view = view;
  const requestSave = vi.fn();
  view.requestSave = requestSave;
  view.setViewData(SOURCE, true);
  return { view, requestSave, leaf, setActiveLeaf, modify, app };
}

describe("TemplateWorkbenchView", () => {
  it("updates the CodeMirror root after a native window move and keeps its document history", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    const frame = cleanup.adopt(document.createElement("iframe"), (element) =>
      element.remove(),
    );
    cleanup.defer(() => act(async () => view.close()));
    document.body.append(frame);
    document.body.append(view.contentEl);
    await act(async () => view.open());
    const controller = view.controller;
    await act(async () => {
      controller.setManifestKey("name", "Moved paper");
    });
    const element = view.contentEl.querySelector<HTMLElement>(".cm-editor")!;
    const editor = EditorView.findFromDOM(element)!;
    frame.contentDocument!.body.append(view.contentEl);
    view.onResize();
    expect(editor.root).toBe(frame.contentDocument);
    expect(view.controller).toBe(controller);
    expect(view.getViewData()).toContain("name: Moved paper");
    await act(async () => {
      controller.undo();
    });
    expect(view.getViewData()).toBe(SOURCE);
  });

  it("shows Name and folder controls without a Settings shortcut", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => view.store.getState().setTab("name"));
    expect(
      view.contentEl.querySelector('[data-part="filename-editor"]'),
    ).not.toBeNull();
    expect(
      [...view.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === m.workbench_open_settings(),
      ),
    ).toBe(false);
  });

  it("keeps a file-known Default disabled when opened with invalid source", async () => {
    await using cleanup = new AsyncDisposableStack();
    const path = "templates/zotlit-profile.default.md";
    const { view } = setup({
      profile: {
        defaultDocumentPath: path,
      } as TemplateWorkbenchDeps["profile"],
    });
    const file = new TFile();
    file.path = path;
    view.file = file;
    view.setViewData("---\nid: [", true);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => view.store.getState().setTab("match"));
    expect(view.store.getState().tab).toBe("note");
    const match = [
      ...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === m.workbench_tab_match())!;
    expect(match.disabled).toBe(true);
    await act(async () => view.store.getState().setTab("name"));
    expect(
      [...view.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === m.workbench_open_settings(),
      ),
    ).toBe(false);
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
        getBuiltInSource: () => SOURCE,
        materializeDefault,
      } as unknown as TemplateWorkbenchDeps["profile"],
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
        getBuiltInSource: () => SOURCE,
        materializeDefault,
      } as unknown as TemplateWorkbenchDeps["profile"],
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
        getBuiltInSource: () => SOURCE,
        materializeDefault: async () => ({ file, created: false }),
      } as unknown as TemplateWorkbenchDeps["profile"],
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
        getBuiltInSource: () => SOURCE,
        materializeDefault,
      } as unknown as TemplateWorkbenchDeps["profile"],
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
    ).find(
      (button) => button.textContent === m.template_workbench_customize(),
    )!;
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
        getBuiltInSource: () => SOURCE,
        materializeDefault: () => pending.promise,
      } as unknown as TemplateWorkbenchDeps["profile"],
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
      } as unknown as TemplateWorkbenchDeps["db"],
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
      } as unknown as TemplateWorkbenchDeps["zoteroPref"],
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

  it("restores editor authoring state beside the file path", async () => {
    const { view } = setup();
    const file = new TFile();
    file.path = "templates/paper.md";
    view.file = file;
    const state = {
      file: file.path,
      tab: "annotation",
      root: "annotation",
      advanced: true,
    };
    const result = { history: false };
    await view.setState(state, result);
    expect(result.history).toBe(true);
    result.history = false;
    await view.setState(state, result);
    expect(result.history).toBe(false);
    expect(view.getState()).toEqual({
      file: file.path,
      tab: "annotation",
      advanced: true,
      itemIndexedKey: null,
      annotationId: null,
    });
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
    expect(menu.items.map((item) => item.title)).toContain(
      "Export selected paper data",
    );
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
    expect(menu.items.map((item) => item.title)).toContain(
      "Save template data as JSON",
    );
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

  it("addresses insertion to one editor and resolves its current language", async () => {
    const { view, leaf, requestSave } = setup();
    const node = {
      kind: "value",
      path: ["title"],
      key: "title",
      label: "title",
      valueType: "string",
      value: "Paper",
      expandable: false,
    } as const;
    document.body.append(view.contentEl);
    try {
      await act(async () => view.open());
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      expect(
        view.insertTemplateField({ leaf: {} as WorkspaceLeaf, node }),
      ).toBe(false);
      expect(requestSave).not.toHaveBeenCalled();
      await act(() => {
        view.controller.setManifestKey("language", "eta");
      });
      requestSave.mockClear();
      await act(() => {
        expect(view.insertTemplateField({ leaf, node })).toBe(true);
      });
      expect(view.getViewData()).toContain("A s<%= zt.title %>table note.");
      expect(requestSave).toHaveBeenCalledOnce();
      await act(() => {
        view.controller.undo();
      });
      expect(view.getViewData()).toContain("A stable note.");
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
    expect(view.insertTemplateField({ leaf, node })).toBe(false);
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

it("recreates persisted editor choices and restores namespaced presentation after mount without focus or layout writes", async () => {
  await using cleanup = new AsyncDisposableStack();
  const original = setup();
  cleanup.defer(() => act(async () => original.view.close()));
  document.body.append(original.view.contentEl);
  cleanup.defer(() => original.view.contentEl.remove());
  await act(async () => original.view.open());
  await act(async () => original.view.store.getState().setAdvanced(true));
  const editor = EditorView.findFromDOM(
    original.view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  const scroll = original.view.contentEl.querySelector<HTMLElement>(
    "[data-workbench-scroll=advanced]",
  )!;
  await act(async () => {
    editor.dispatch({ selection: { anchor: 25, head: 7 } });
    scroll.scrollTop = 43;
    scroll.dispatchEvent(new Event("scroll"));
  });
  const persisted = original.view.getState();
  const ephemeral = original.view.getEphemeralState();
  expect(ephemeral).not.toHaveProperty("cursor");
  expect(ephemeral).not.toHaveProperty("scroll");
  expect(persisted).not.toHaveProperty("presentation");
  expect(persisted).not.toHaveProperty("root");
  const restored = setup();
  cleanup.defer(() => act(async () => restored.view.close()));
  document.body.append(restored.view.contentEl);
  cleanup.defer(() => restored.view.contentEl.remove());
  const typing = document.createElement("input");
  document.body.append(typing);
  cleanup.defer(() => typing.remove());
  typing.focus();
  await act(async () =>
    restored.view.setState(persisted, {} as ViewStateResult),
  );
  restored.view.setEphemeralState(ephemeral);
  await act(async () => restored.view.open());
  const restoredEditor = EditorView.findFromDOM(
    restored.view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(restoredEditor.state.selection.main.anchor).toBe(25);
  expect(restoredEditor.state.selection.main.head).toBe(7);
  expect(
    restored.view.contentEl.querySelector<HTMLElement>(
      "[data-workbench-scroll=advanced]",
    )!.scrollTop,
  ).toBe(43);
  expect(document.activeElement).toBe(typing);
  expect(restored.view.getState()).toEqual(persisted);
  const saves = vi.mocked(restored.app.workspace.requestSaveLayout);
  saves.mockClear();
  await act(async () => {
    restoredEditor.dispatch({ selection: { anchor: 5 } });
    restored.view.contentEl
      .querySelector<HTMLElement>("[data-workbench-scroll=advanced]")!
      .dispatchEvent(new Event("scroll"));
  });
  expect(saves).not.toHaveBeenCalled();
  expect(restored.view.getState()).toEqual(persisted);
});

it("clamps stale restored ranges, ignores removed Properties, and discards a different Item's presentation", async () => {
  await using cleanup = new AsyncDisposableStack();
  const { view } = setup();
  cleanup.defer(() => act(async () => view.close()));
  await act(async () => {
    await view.open();
    view.store.getState().setAdvanced(true);
  });
  const saved = view.getEphemeralState() as {
    zotlitTemplateWorkbench: Record<string, unknown>;
  };
  saved.zotlitTemplateWorkbench.selection = {
    slice: "advanced",
    range: { from: -8, to: 99999 },
  };
  saved.zotlitTemplateWorkbench.selected = 55;
  await act(async () => view.setEphemeralState(saved));
  const editor = EditorView.findFromDOM(
    view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(editor.state.selection.main.from).toBe(0);
  expect(editor.state.selection.main.to).toBe(SOURCE.length);
  expect(view.store.getState().presentation.selected).toBeNull();
  await act(async () =>
    view.store.getState().setItem({ id: "OTHER001", title: "Other" }),
  );
  await act(async () => editor.dispatch({ selection: { anchor: 3 } }));
  await act(async () => view.setEphemeralState(saved));
  expect(editor.state.selection.main.head).toBe(3);
});

it("unloads and saves a named Profile before restoring a file-free built-in descriptor", async () => {
  await using cleanup = new AsyncDisposableStack();
  const builtin = SOURCE.replace("id: paper", "id: default").replace(
    "A stable note.",
    "Built-in note.",
  );
  const { view, app } = setup({
    profile: {
      getBuiltInSource: () => builtin,
    } as TemplateWorkbenchDeps["profile"],
  });
  cleanup.defer(() => act(async () => view.close()));
  const file = new TFile();
  file.path = "templates/paper.md";
  view.file = file;
  const writes: { file: TFile | null; source: string }[] = [];
  const save = vi.spyOn(view, "save").mockImplementation(async () => {
    writes.push({ file: view.file, source: view.getViewData() });
  });
  cleanup.defer(() => save.mockRestore());
  const publish = vi.spyOn(app.workspace, "trigger");
  cleanup.defer(() => publish.mockRestore());
  await act(async () =>
    view.setState(
      { defaultDraft: true, tab: "match", advanced: false },
      { history: false },
    ),
  );
  expect(writes).toEqual([{ file, source: SOURCE }]);
  expect(view.file).toBeNull();
  expect(view.getState()).toEqual({
    file: null,
    defaultDraft: true,
    tab: "note",
    advanced: false,
    itemIndexedKey: null,
    annotationId: null,
  });
  expect(view.controller.readOnly).toBe(true);
  expect(view.getViewData()).toBe(builtin);
  expect(publish).not.toHaveBeenCalledWith("quick-preview", file, builtin);
});

describe("the Template Document kind picks the tabs and the tab title", () => {
  const CITATION_SOURCE = `---
language: liquid
---
{% if zt.variant == "alt" %}{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}{% else %}{{ zt.citations | pandoc_cite }}{% endif %}
`;

  const PARTIAL_SOURCE = `---
language: liquid
---
{{ zt.authors | join: ", " }}
`;

  function openKind(path: string, source: string) {
    const harness = setup({
      templates: {
        materializeCitationTemplate: vi.fn(),
      } as unknown as TemplateWorkbenchDeps["templates"],
    });
    const file = new TFile();
    file.path = path;
    harness.view.file = file;
    harness.view.setViewData(source, true);
    return harness;
  }

  const tabLabels = (view: TemplateWorkbenchView) =>
    [...view.contentEl.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );

  /** The Basic and Source view action, which only a Profile document offers. */
  const sourceAction = (view: TemplateWorkbenchView) =>
    (view as unknown as { actions: HTMLElement[] }).actions.find(
      (action) => action.getAttribute("aria-label") === m.workbench_advanced(),
    )!;

  it("opens the Citation Template on a lone Citation tab titled Citation text", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(m.template_workbench_title_citation());
    expect(tabLabels(view)).toEqual([m.workbench_tab_citation()]);
    expect(view.store.getState()).toMatchObject({
      tab: "citation",
      root: "citation",
      advanced: false,
    });
    expect(sourceAction(view).style.display).toBe("none");
  });

  it("keeps a Profile document on its six tabs, titled by its name", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-profile.paper.md", SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(
      m.template_workbench_title_profile({ label: "Paper" }),
    );
    expect(tabLabels(view)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
      m.workbench_tab_match(),
      m.workbench_tab_profile(),
    ]);
    expect(sourceAction(view).style.display).not.toBe("none");
  });

  it("returns a leaf that held the Citation Template to the Profile tabs", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    expect(view.store.getState()).toMatchObject({
      tab: "citation",
      root: "citation",
    });

    const profile = new TFile();
    profile.path = "templates/zotlit-profile.paper.md";
    await act(async () => {
      view.file = profile;
      view.setViewData(SOURCE, true);
    });

    // The Citation tab names no panel a Profile document has, so the six
    // Profile tabs open on the first of them rather than on none.
    expect(view.store.getState()).toMatchObject({ tab: "note", root: "note" });
    expect(tabLabels(view)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
      m.workbench_tab_match(),
      m.workbench_tab_profile(),
    ]);
    expect(
      view.contentEl.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe(m.workbench_tab_note());
  });

  it("offers Open citation text on every kind, and the language switch on the Citation Template", async () => {
    await using cleanup = new AsyncDisposableStack();
    const profile = openKind("templates/zotlit-profile.paper.md", SOURCE);
    cleanup.defer(() => act(async () => profile.view.close()));
    const citation = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => citation.view.close()));

    const titles = (view: TemplateWorkbenchView) => {
      const menu = new Menu();
      view.onPaneMenu(menu as never, "more-options");
      return menu.items.map((item) => item.title);
    };
    expect(titles(profile.view)).toContain(
      m.template_workbench_open_citation(),
    );
    expect(titles(profile.view)).not.toContain(
      m.template_workbench_change_language(),
    );
    expect(titles(citation.view)).toContain(
      m.template_workbench_open_citation(),
    );
    expect(titles(citation.view)).toContain(
      m.template_workbench_change_language(),
    );
    // The annotation example belongs to a Profile's own Annotation Section.
    expect(titles(citation.view)).not.toContain(
      m.workbench_choose_annotation(),
    );
  });

  it("lists the vault's partials in the pane menu and ends with New partial", () => {
    const { view } = setup({
      templates: {
        loaded: true,
        getPartialNames: () => ["authors", "venue-line"],
        getPartialDocuments: () => [
          {
            name: "authors",
            path: "templates/zotlit-partial.authors.md",
            language: "liquid",
          },
          {
            name: "venue-line",
            path: "templates/zotlit-partial.venue-line.md",
            language: "liquid",
          },
        ],
      } as unknown as TemplateWorkbenchDeps["templates"],
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");

    const partials = menu.items.find(
      (item) => item.title === m.template_workbench_partials(),
    )!;
    expect(partials.submenu?.items.map((item) => item.title)).toEqual([
      "authors",
      "venue-line",
      m.workbench_partial_new(),
    ]);
  });

  it("reports the partials a shared Profile still carries, and unpacks them", async () => {
    const bundled = SOURCE.replace(
      "filename: paper",
      [
        "filename: paper",
        "partials:",
        "  - name: authors",
        "    language: liquid",
        "    source: Authors",
        "  - name: venue-line",
        "    language: liquid",
        "    source: Venue",
      ].join("\n"),
    );
    const unpacked: string[] = [];
    const { view } = setup({
      templates: {
        loaded: true,
        getPartialNames: () => [],
        getPartialDocuments: () => [],
        planPartialUnpack: (
          partials: readonly { name: string; source: string }[],
        ) =>
          partials.map(({ name, source }) => ({
            name,
            // The vault holds a venue-line of the reader's own already.
            verdict: name === "venue-line" ? "conflict" : "write",
            document: source,
          })),
        unpackPartials: async (
          plan: readonly { name: string; verdict: string }[],
        ) => {
          unpacked.push(...plan.map(({ name }) => name));
          const written = plan
            .filter(({ verdict }) => verdict === "write")
            .map(({ name }) => name);
          return {
            written,
            kept: ["venue-line"],
            dropped: plan.map(({ name }) => name),
          };
        },
      } as unknown as TemplateWorkbenchDeps["templates"],
    });
    view.setViewData(bundled, true);
    expect(view.controller.problems[0]).toMatchObject({
      code: "bundled-partial",
      params: { names: "authors, venue-line" },
    });

    // Both entries go — the written one and the one the reader's own file
    // answers — so the problem clears and neither name has two homes left.
    expect(await view.unpackBundledPartials()).toBe(true);
    expect(unpacked).toEqual(["authors", "venue-line"]);
    expect(view.getViewData()).not.toContain("partials:");
    expect(view.getViewData()).toContain("filename: paper");
    expect(view.controller.problems).toEqual([]);
  });

  it("names no partial while the template service is still scanning the folder", () => {
    const { view } = setup({
      templates: {
        loaded: false,
        getPartialNames: () => {
          throw new Error(
            "TemplateService.getPartialNames(): service is not ready",
          );
        },
        getPartialDocuments: () => [],
      } as unknown as TemplateWorkbenchDeps["templates"],
    });

    // The placeholder reads this during render, before the folder scan ends.
    expect(view.partialNames).toEqual([]);
  });

  it("writes an Explorer field into the Citation Template's one editor", async () => {
    const { view, leaf } = openKind(
      "templates/zotlit-citation.md",
      CITATION_SOURCE,
    );
    await using cleanup = new AsyncDisposableStack();
    document.body.append(view.contentEl);
    cleanup.defer(() => view.contentEl.remove());
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0 } });
    });
    await act(() => {
      expect(
        view.insertTemplateField({
          leaf,
          node: {
            kind: "value",
            path: ["variant"],
            key: "variant",
            label: "variant",
            valueType: "string",
            value: "main",
            expandable: false,
          },
        }),
      ).toBe(true);
    });
    expect(view.getViewData()).toBe(
      CITATION_SOURCE.replace("{% if", "{{ zt.variant }}{% if"),
    );
  });

  it("opens a Shared Partial on a lone Partial tab titled by its name", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(
      m.template_workbench_title_partial({ name: "authors" }),
    );
    expect(tabLabels(view)).toEqual([m.workbench_tab_partial()]);
    expect(view.store.getState()).toMatchObject({
      tab: "partial",
      root: "note",
      advanced: false,
    });
    expect(view.partialContext).toBe("note");
    expect(sourceAction(view).style.display).toBe("none");
  });

  it("offers the language switch and the annotation chooser on a partial", () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const titles = menu.items.map((item) => item.title);

    expect(titles).toContain(m.template_workbench_change_language());
    expect(titles).toContain(m.workbench_choose_annotation());
  });

  it("follows a chosen caller with the completion root and the saved state", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    expect(view.controller.templateRegions[0]!.root).toBe("note");

    await act(async () =>
      view.setPartialSelection({ context: "annotation", profile: "reading1" }),
    );

    expect(view.store.getState().root).toBe("annotation");
    expect(view.controller.templateRegions[0]!.root).toBe("annotation");
    expect(view.authoringContext.partial).toEqual({
      name: "authors",
      context: "annotation",
      profile: "reading1",
    });
    const saved = view.getState();
    expect(saved).toMatchObject({
      partialContext: "annotation",
      partialProfile: "reading1",
    });

    // The workspace hands the same descriptor back when the file reopens.
    const reopened = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      reopened.view.setState(
        { ...saved, file: "templates/zotlit-partial.authors.md" },
        { history: false },
      ),
    );
    expect(reopened.view.partialContext).toBe("annotation");
    expect(reopened.view.partialProfile).toBe("reading1");
    expect(reopened.view.controller.templateRegions[0]!.root).toBe(
      "annotation",
    );
  });

  it("opens another partial on the default caller, not the last one's", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      view.setPartialSelection({ context: "annotation", profile: "reading1" }),
    );

    // The same leaf moves to a second partial, which was never chosen for.
    const other = new TFile();
    other.path = "templates/zotlit-partial.venue.md";
    await act(async () => {
      view.file = other;
      view.setViewData(PARTIAL_SOURCE, true);
    });

    expect(view.partialContext).toBe("note");
    expect(view.partialProfile).toBeNull();
    expect(view.controller.templateRegions[0]!.root).toBe("note");
    expect(view.getState()).toMatchObject({
      partialContext: "note",
      partialProfile: null,
    });
  });

  it("returns a leaf that held a partial to the Profile tabs", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      view.setPartialSelection({ context: "citation", profile: null }),
    );

    const profile = new TFile();
    profile.path = "templates/zotlit-profile.paper.md";
    await act(async () => {
      view.file = profile;
      view.setViewData(SOURCE, true);
    });

    expect(view.store.getState()).toMatchObject({ tab: "note", root: "note" });
  });

  it("switches the rendering language on the manifest key alone", () => {
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const language = menu.items.find(
      (item) => item.title === m.template_workbench_change_language(),
    )!;
    language
      .submenu!.items.find(
        (item) => item.title === m.workbench_name_language_eta(),
      )!
      .click();

    expect(view.getViewData()).toBe(
      CITATION_SOURCE.replace("language: liquid", "language: eta"),
    );
    expect(view.controller.plainDocument?.manifest.language).toBe("eta");
  });
});

describe("Extract to partial", () => {
  const EXTRACT_SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
---
{{ zt.authors }}
{{ zt.publicationTitle }}
{{ zt.date }}
--- zotlit:annotation ---
An annotation.
`;

  /** The three lines the reader selects, hand-counted off EXTRACT_SOURCE. */
  const SELECTION =
    "{{ zt.authors }}\n{{ zt.publicationTitle }}\n{{ zt.date }}";

  /** The Liquid call the extraction leaves in its place. */
  const CALL = '{% render "authors" with zt as zt %}';

  /** Every row the menu carries, in order; the extraction is the last one. */
  const MENU_TITLES = [
    m.template_workbench_cut(),
    m.template_workbench_copy(),
    m.template_workbench_paste(),
    m.template_workbench_extract_partial(),
  ];

  async function openProfile(language: "liquid" | "eta") {
    const harness = setup();
    harness.view.setViewData(
      language === "eta"
        ? EXTRACT_SOURCE.replace("language: liquid", "language: eta")
        : EXTRACT_SOURCE,
      true,
    );
    document.body.append(harness.view.contentEl);
    await act(async () => harness.view.open());
    const editor = EditorView.findFromDOM(
      harness.view.contentEl.querySelector(".cm-editor")!,
    )!;
    return { ...harness, editor };
  }

  /** The right-click gesture, answering with the menu it opened or none. */
  function rightClick(editor: EditorView): Menu | null {
    const opened = Menu.instances.length;
    editor.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    return Menu.instances[opened] ?? null;
  }

  async function extract(editor: EditorView, head: number) {
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head } });
    });
    const menu = rightClick(editor);
    expect(menu?.items.map((item) => item.title)).toEqual(MENU_TITLES);
    await act(async () => {
      menu!.items.at(-1)!.click();
      await Promise.resolve();
    });
  }

  it("leaves a Liquid render tag over the three lines it moved out", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartial).mockResolvedValueOnce("authors");
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, SELECTION.length);

    expect(vi.mocked(createSharedPartial).mock.lastCall?.[2]).toEqual({
      source: SELECTION,
      open: "split",
    });
    expect(view.getViewData()).toBe(EXTRACT_SOURCE.replace(SELECTION, CALL));
  });

  it("writes an Eta include and asks the create flow for an Eta partial", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartial).mockResolvedValueOnce("authors");
    const { view, editor } = await openProfile("eta");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, SELECTION.length);

    expect(vi.mocked(createSharedPartial).mock.lastCall?.[2]).toEqual({
      source: SELECTION,
      language: "eta",
      open: "split",
    });
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace("language: liquid", "language: eta").replace(
        SELECTION,
        '<%~ include("authors", zt) %>',
      ),
    );
  });

  // One transaction is one history event, so this passes on the dispatch alone;
  // the isolated-history annotation is what the next test guards.
  it("restores the selection in one undo and keeps the created file", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartial).mockResolvedValueOnce("authors");
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    await extract(editor, SELECTION.length);

    await act(() => {
      view.controller.undo();
    });

    expect(view.getViewData()).toBe(EXTRACT_SOURCE);
    expect(view.controller.canUndo).toBe(false);
    // Undo rewrites the caller alone: nothing takes the partial back.
    expect(createSharedPartial).toHaveBeenCalledOnce();
  });

  it("keeps the keystrokes around it out of its undo step", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartial).mockResolvedValueOnce("authors");
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    const type = (from: number, insert: string) =>
      act(() => {
        editor.focus();
        editor.dispatch({ changes: { from, insert }, userEvent: "input.type" });
      });
    await type(SELECTION.length, " · 2020");

    await extract(editor, SELECTION.length);
    await type(CALL.length, "!");
    await act(() => {
      view.controller.undo();
    });

    // One undo takes back the keystroke alone, and the next one the extraction
    // alone: neither joins the other.
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${CALL} · 2020`),
    );
    await act(() => {
      view.controller.undo();
    });
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${SELECTION} · 2020`),
    );
  });

  it("keeps a changed template and says the call was not written", async () => {
    await using cleanup = new AsyncDisposableStack();
    const prompt = Promise.withResolvers<string | null>();
    vi.mocked(createSharedPartial).mockReturnValueOnce(prompt.promise);
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head: SELECTION.length } });
    });
    await act(async () => {
      rightClick(editor)!.items.at(-1)!.click();
      await Promise.resolve();
    });

    // The reader edits the template while the name prompt is still open.
    await act(() => {
      editor.dispatch({
        changes: { from: SELECTION.length, insert: " · 2020" },
        userEvent: "input.type",
      });
    });
    const shown = Notice.instances.length;
    await act(async () => {
      prompt.resolve("authors");
      await prompt.promise;
      await Promise.resolve();
    });

    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${SELECTION} · 2020`),
    );
    expect(
      Notice.instances.slice(shown).map((notice) => notice.message),
    ).toEqual([m.notice_partial_extract_stale()]);
  });

  it("cuts the selection out to the clipboard", async () => {
    await using cleanup = new AsyncDisposableStack();
    // The gesture takes the Electron menu's place, so the menu owns cut itself.
    const writeText = vi.fn(async () => {});
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    cleanup.defer(() => {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    });
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head: SELECTION.length } });
    });

    const menu = rightClick(editor);
    expect(menu?.items.map((item) => item.title)).toEqual(MENU_TITLES);
    await act(async () => {
      menu!.items[0]!.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(SELECTION);
    expect(view.getViewData()).toBe(EXTRACT_SOURCE.replace(SELECTION, ""));
    expect(createSharedPartial).not.toHaveBeenCalled();
  });

  it("offers no action over an empty selection", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 4 } });
    });

    expect(rightClick(editor)).toBeNull();
    expect(createSharedPartial).not.toHaveBeenCalled();
  });
});
