import { Effect, Queue } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { describe, expect, it } from "vitest";

import { createWorkbenchEditor } from "./editor";
import {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartial,
  INITIAL_VIEW,
  setAdvanced,
  setPreview,
  setRoot,
  setTab,
} from "./model";
import type { WorkbenchItemData, WorkbenchViewState } from "./model";
import { fakeHost, TEST_RUNTIME } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#/render/index";

const PAPER = SAMPLE_ITEMS[0]!;
const CHOICE = { id: "1:ABCDEFGH", title: "A paper" } as const;

/** The chosen Item's data, which a host derives from its read of the Item. */
const itemData = () => Atom.make<WorkbenchItemData>({ snapshot: null });

/** Puts the chosen Item's data in the model, as the host's read of it does. */
function load(opened: ReturnType<typeof open>) {
  opened.registry.update(opened.itemData, (data) => ({
    ...data,
    snapshot: PAPER,
  }));
}

function open(options: { view?: Atom.Writable<WorkbenchViewState> } = {}) {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const data = itemData();
  const editor = createWorkbenchEditor({
    host,
    controller,
    registry,
    runtime: TEST_RUNTIME,
    itemData: () => data,
    ...options,
  });
  return {
    host,
    itemData: data,
    controller,
    registry,
    editor,
    model: editor.model,
    [Symbol.dispose]() {
      editor[Symbol.dispose]();
      registry.dispose();
    },
  };
}

/** Takes the start signal of the next render `host` was asked for. */
const started = (host: ReturnType<typeof fakeHost>) =>
  Effect.runPromise(Queue.take(host.started));

function noteEdit(controller: WorkbenchDocumentController, insert: string) {
  const { from } = controller.sliceRange("note");
  controller.dispatch({ changes: { from, insert }, userEvent: "input.type" });
}

describe("the Workbench model", () => {
  it("reads the chosen Item back from the model", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    expect(registry.get(model.item)).toEqual(CHOICE);
  });

  it("reads and writes the state a host view atom holds", () => {
    const view = Atom.make<WorkbenchViewState>({
      ...INITIAL_VIEW,
      tab: "properties",
    });
    using opened = open({ view });
    const { registry, model } = opened;
    expect(registry.get(model.tab)).toBe("properties");
    registry.update(view, setTab("name"));
    expect(registry.get(model.tab)).toBe("name");
    registry.update(model.view, setAdvanced(true));
    expect(registry.get(view).advanced).toBe(true);
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
    const { registry, model, host } = opened;
    const citation = { variant: "main", example: "one-item" } as const;
    const partial = {
      name: "book-details",
      context: "note",
      profile: null,
    } as const;
    load(opened);
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[0]!));
    registry.update(model.choices, chooseCitation(citation));
    registry.update(model.choices, choosePartial(partial));
    registry.update(model.choices, setPreview({ mode: "update" }));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(1);
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
    load(opened);
    noteEdit(controller, "Edited ");
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(1);
    expect(host.renders[0]!.request.source).toContain("Edited ");

    editor.attach(new WorkbenchDocumentController("Replaced"));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(2);
    expect(host.renders[1]!.request.source).toBe("Replaced");
  });

  it("interrupts the render in flight when the editor goes and the host keeps the registry", async () => {
    using opened = open();
    const { registry, model, editor, host } = opened;
    load(opened);
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(1);
    editor[Symbol.dispose]();
    await host.renders[0]!.interruption;
  });

  it("disposes the registry it made, which interrupts the render in flight", async () => {
    const host = fakeHost();
    const data = itemData();
    const editor = createWorkbenchEditor({
      host,
      controller: new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
      runtime: TEST_RUNTIME,
      itemData: () => data,
    });
    const { registry, model } = editor;
    registry.update(data, (held) => ({ ...held, snapshot: PAPER }));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(1);
    editor[Symbol.dispose]();
    expect(host.renders[0]!.interrupted).toBe(true);
    expect(() => registry.set(model.scheduler.run, undefined)).toThrow(
      "registry is disposed",
    );
  });
});
