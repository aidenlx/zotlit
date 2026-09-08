import { EditorView } from "@codemirror/view";
import { Menu } from "@mock/obsidian";
import type { Scope as MockScope } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { ProfileEditorView } from "./view";
import type { ProfileEditorDeps } from "./view";

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

function setup(deps: Partial<ProfileEditorDeps> = {}) {
  const setActiveLeaf = vi.fn();
  const modify = vi.fn<(file: TFile, source: string) => Promise<void>>(
    async () => {},
  );
  const app = {
    scope: null,
    workspace: {
      requestSaveLayout: vi.fn(),
      setActiveLeaf,
      getActiveFile: () => null,
    },
    loadLocalStorage: () => null,
    vault: { modify },
  } as unknown as App;
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
  const requestSave = vi.fn();
  view.requestSave = requestSave;
  view.setViewData(SOURCE, true);
  return { view, requestSave, leaf, setActiveLeaf, modify };
}

describe("ProfileEditorView", () => {
  it("keeps a newly opened Profile when creation of the previous Default draft finishes", async () => {
    const file = new TFile();
    file.path = "templates/zotlit-profile.default.md";
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const { view, leaf, modify } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault: () => pending.promise,
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState(
      { defaultDraft: true, file: null },
      {} as ViewStateResult,
    );
    view.controller.setManifestKey("name", "First draft edit");
    view.controller.setManifestKey("name", "Last draft edit");
    await view.setState(
      { file: "templates/zotlit-profile.other.md" },
      {} as ViewStateResult,
    );
    view.setViewData(
      SOURCE.replace("name: Paper", "name: Other Profile"),
      true,
    );
    const current = view.controller;
    pending.resolve({ file, created: true });
    await view.materializeDefault();
    expect(view.controller).toBe(current);
    expect(view.getViewData()).toContain("name: Other Profile");
    expect(modify).toHaveBeenCalledWith(
      file,
      expect.stringContaining("name: Last draft edit"),
    );
    expect(modify.mock.calls[0]?.[1]).not.toContain("Other Profile");
    expect(vi.spyOn(leaf, "setViewState")).not.toHaveBeenCalled();
  });
  it("creates Default once on first edit and preserves later edits and Undo while binding", async () => {
    const file = new TFile();
    file.path = "templates/zotlit-profile.default.md";
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const materializeDefault = vi.fn(() => pending.promise);
    const { view, leaf, requestSave } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault,
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState(
      { defaultDraft: true, file: null },
      {} as ViewStateResult,
    );
    expect(materializeDefault).not.toHaveBeenCalled();
    expect(view.file).toBeNull();
    const controller = view.controller;
    view.controller.setManifestKey("name", "First edit");
    view.controller.setManifestKey("name", "Latest edit");
    expect(materializeDefault).toHaveBeenCalledOnce();
    expect(requestSave).not.toHaveBeenCalled();
    vi.spyOn(leaf, "setViewState").mockImplementation(async () => {
      view.setViewData(SOURCE, true);
    });
    pending.resolve({ file, created: true });
    await view.materializeDefault();
    expect(view.controller).toBe(controller);
    expect(view.getViewData()).toContain("Latest edit");
    expect(view.isDefaultDraft).toBe(false);
    expect(requestSave).toHaveBeenCalledOnce();
    view.controller.undo();
    expect(view.getViewData()).toContain("First edit");
  });

  it("keeps a competing Default untouched and retains the draft for recovery", async () => {
    const file = new TFile();
    const { view, leaf, requestSave } = setup({
      profile: {
        getSource: async () => SOURCE,
        materializeDefault: async () => ({ file, created: false }),
      } as unknown as ProfileEditorDeps["profile"],
    });
    await view.setState({ defaultDraft: true }, {} as ViewStateResult);
    view.controller.setManifestKey("name", "Kept draft");
    await view.materializeDefault();
    expect(view.isDefaultDraft).toBe(true);
    expect(view.getViewData()).toContain("Kept draft");
    expect(vi.spyOn(leaf, "setViewState")).not.toHaveBeenCalled();
    expect(requestSave).not.toHaveBeenCalled();
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
