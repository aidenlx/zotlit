import type { Scope as MockScope } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

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

function setup() {
  const app = {
    scope: null,
    workspace: { requestSaveLayout: vi.fn() },
  } as unknown as App;
  const leaf = {
    app,
    setViewState: vi.fn(async () => {}),
  } as unknown as WorkspaceLeaf;
  const view = new ProfileEditorView(leaf, {
    app,
    settings: { subscribe: () => () => {} },
  } as unknown as ProfileEditorDeps);
  const requestSave = vi.fn();
  view.requestSave = requestSave;
  view.setViewData(SOURCE, true);
  return { view, requestSave, leaf };
}

describe("ProfileEditorView", () => {
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
});
