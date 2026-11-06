import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vitest";

import { createWorkbenchEditor } from "./editor";
import {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartial,
  setAdvanced,
  setPreview,
  setRoot,
  setTab,
} from "./model";
import { createWorkbenchStore } from "./store";
import { fakeHost } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#/render/index";

const PAPER = SAMPLE_ITEMS[0]!;
const CHOICE = { id: "1:ABCDEFGH", title: "A paper" } as const;

function open(
  options: { store?: ReturnType<typeof createWorkbenchStore> } = {},
) {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const editor = createWorkbenchEditor({
    host,
    controller,
    registry,
    ...options,
  });
  return {
    host,
    controller,
    registry,
    editor,
    model: editor.model,
    [Symbol.dispose]() {
      editor[Symbol.dispose]();
      registry.dispose();
      host.close();
    },
  };
}

function noteEdit(controller: WorkbenchDocumentController, insert: string) {
  const { from } = controller.sliceRange("note");
  controller.dispatch({ changes: { from, insert }, userEvent: "input.type" });
}

describe("the Workbench model", () => {
  it("shows the chosen Item to every reader of the editor", () => {
    using opened = open();
    const { registry, model, editor } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    expect(registry.get(model.item)).toEqual(CHOICE);
    expect(editor.store.getState().item).toEqual(CHOICE);
  });

  it("reads and writes the state a host store holds", () => {
    const store = createWorkbenchStore({ tab: "properties" });
    using opened = open({ store });
    const { registry, model } = opened;
    expect(registry.get(model.tab)).toBe("properties");
    store.getState().setTab("name");
    expect(registry.get(model.tab)).toBe("name");
    registry.update(model.view, setAdvanced(true));
    expect(store.getState().advanced).toBe(true);
  });

  it("keeps the state when a transition changes nothing", () => {
    using opened = open();
    const { registry, model } = opened;
    const view = registry.get(model.view);
    const choices = registry.get(model.choices);
    for (const transition of [
      setTab("note"),
      setRoot("note"),
      chooseItem(null),
    ])
      registry.update(model.view, transition);
    registry.update(model.choices, setPreview({ mode: "create", live: true }));
    registry.update(model.choices, chooseAnnotation(null));
    expect(registry.get(model.view)).toBe(view);
    expect(registry.get(model.choices)).toBe(choices);
  });

  it("feeds the chosen annotation, citation, caller, and preview mode to the render", async () => {
    using opened = open();
    const { registry, model, editor, host } = opened;
    const citation = { variant: "main", example: "one-item" } as const;
    const partial = {
      name: "book-details",
      context: "note",
      profile: null,
    } as const;
    editor.scheduler.setInput({ snapshot: PAPER });
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[0]!));
    registry.update(model.choices, chooseCitation(citation));
    registry.update(model.choices, choosePartial(partial));
    registry.update(model.choices, setPreview({ mode: "update" }));
    registry.set(model.scheduler.run, undefined);
    await vi.waitFor(() => expect(host.renders).toHaveLength(1));
    expect(host.renders[0]!.request).toMatchObject({
      mode: "update",
      snapshot: PAPER,
      annotation: SAMPLE_ANNOTATIONS[0],
      citation,
      partial,
    });
  });

  it("renders the source of the controller in use, after an edit and a replacement", async () => {
    using opened = open();
    const { registry, model, editor, host, controller } = opened;
    editor.scheduler.setInput({ snapshot: PAPER });
    noteEdit(controller, "Edited ");
    registry.set(model.scheduler.run, undefined);
    await vi.waitFor(() => expect(host.renders).toHaveLength(1));
    expect(host.renders[0]!.request.source).toContain("Edited ");

    editor.attach(new WorkbenchDocumentController("Replaced"));
    registry.set(model.scheduler.run, undefined);
    await vi.waitFor(() => expect(host.renders).toHaveLength(2));
    expect(host.renders[1]!.request.source).toBe("Replaced");
  });

  it("interrupts the render in flight when the editor goes from a registry the host keeps", async () => {
    using opened = open();
    const { registry, model, editor, host } = opened;
    editor.scheduler.setInput({ snapshot: PAPER });
    registry.set(model.scheduler.run, undefined);
    await vi.waitFor(() => expect(host.renders).toHaveLength(1));
    editor[Symbol.dispose]();
    await host.renders[0]!.interruption;
  });

  it("interrupts the render in flight when the editor goes", async () => {
    const opened = open();
    const { registry, model, editor, host } = opened;
    editor.scheduler.setInput({ snapshot: PAPER });
    registry.set(model.scheduler.run, undefined);
    await vi.waitFor(() => expect(host.renders).toHaveLength(1));
    opened[Symbol.dispose]();
    expect(host.renders[0]!.interrupted).toBe(true);
  });
});
