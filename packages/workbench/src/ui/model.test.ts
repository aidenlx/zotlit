import type { WorkbenchDocumentKind } from "#/document/index";
import { Effect, Queue } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vitest";

import { createWorkbenchEditor } from "./editor";
import {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartialProfile,
  INITIAL_VIEW,
  setAdvanced,
  setPreview,
  setRoot,
  setTab,
} from "./model";
import type { WorkbenchItemData, WorkbenchViewState } from "./model";
import {
  panelLimit,
  PANEL_WIDTH,
  setPanelWidth,
  setPreviewHeight,
  showPanel,
} from "./panel-layout";
import type { ViewSize } from "./panel-layout";
import { fakeHost, TEST_RUNTIME } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import {
  CITATION_EXAMPLE_ITEM,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
} from "#/render/index";

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

function open(
  options: {
    view?: Atom.Writable<WorkbenchViewState>;
    kind?: WorkbenchDocumentKind;
    partialName?: Atom.Atom<string | null>;
    viewSize?: Atom.Atom<ViewSize | null>;
  } = {},
) {
  const { kind, ...rest } = options;
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(
    kind && kind !== "profile" ? "Body" : DEFAULT_PROFILE_SOURCE,
    kind ? { kind } : {},
  );
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
    ...rest,
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

  it("feeds the chosen annotation and preview mode to the render", async () => {
    using opened = open();
    const { registry, model, host } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    load(opened);
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[1]!.id));
    registry.update(model.choices, setPreview({ mode: "update" }));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders).toHaveLength(1);
    const { request } = host.renders[0]!;
    expect(request).toMatchObject({ mode: "update", snapshot: PAPER });
    expect(request.annotation?.id).toBe(SAMPLE_ANNOTATIONS[1]!.id);
    expect(request.citation).toBeUndefined();
    expect(request.partial).toBeUndefined();
  });

  it("feeds a Shared Partial's caller and Profile to the render", async () => {
    const partialName = Atom.make<string | null>("book-details");
    using opened = open({ kind: "partial", partialName });
    const { registry, model, host } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    load(opened);
    registry.update(model.view, setRoot("annotation"));
    registry.update(model.choices, choosePartialProfile("thesis"));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders[0]!.request.partial).toEqual({
      name: "book-details",
      context: "annotation",
      profile: "thesis",
    });
  });

  it("feeds the chosen Citation set, whose built-in example outranks the Item", async () => {
    using opened = open({ kind: "citation" });
    const { registry, model, host } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    load(opened);
    registry.update(model.choices, chooseCitation({ variant: "alt" }));
    registry.set(model.scheduler.run, undefined);
    await started(host);
    expect(host.renders[0]!.request).toMatchObject({
      snapshot: CITATION_EXAMPLE_ITEM,
      citation: { variant: "alt", example: "one-item" },
    });
  });
});

describe("the side panels", () => {
  it("starts with both panels hidden at their initial width", () => {
    using opened = open();
    const { registry, model } = opened;
    expect(registry.get(model.panels)).toEqual({
      fields: { shown: false, width: 400 },
      preview: { shown: false, width: 400, height: 40 },
    });
  });

  it("shows one panel and leaves the other hidden", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.panels, showPanel("preview", true));
    expect(registry.get(model.panels)).toEqual({
      fields: { shown: false, width: 400 },
      preview: { shown: true, width: 400, height: 40 },
    });
  });

  it("sets a panel's width in whole pixels", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.panels, setPanelWidth("preview", 520.4));
    expect(registry.get(model.panels).preview.width).toBe(520);
  });

  it("holds a panel's width within the limits", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.panels, setPanelWidth("fields", 5000));
    expect(registry.get(model.panels).fields.width).toBe(PANEL_WIDTH.max);
    registry.update(model.panels, setPanelWidth("fields", 10));
    expect(registry.get(model.panels).fields.width).toBe(PANEL_WIDTH.min);
  });

  it("keeps the panels when a transition changes nothing", () => {
    using opened = open();
    const { registry, model } = opened;
    const panels = registry.get(model.panels);
    registry.update(model.panels, showPanel("preview", false));
    registry.update(model.panels, setPanelWidth("fields", 400));
    expect(registry.get(model.panels)).toBe(panels);
  });

  it("holds the Preview's height under the editor within its shares", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.panels, setPreviewHeight(55.4));
    expect(registry.get(model.panels).preview.height).toBe(55);
    registry.update(model.panels, setPreviewHeight(95));
    expect(registry.get(model.panels).preview.height).toBe(80);
    registry.update(model.panels, setPreviewHeight(5));
    expect(registry.get(model.panels).preview.height).toBe(20);
  });

  it("places the panels from the view size the host measures, and keeps the panels", () => {
    const viewSize = Atom.make<ViewSize | null>({ width: 1200, height: 800 });
    using opened = open({ viewSize });
    const { registry, model } = opened;
    registry.update(model.panels, showPanel("preview", true));
    registry.update(model.panels, showPanel("fields", true));
    const panels = registry.get(model.panels);
    expect(registry.get(model.placement)).toEqual({
      preview: "side",
      fields: "column",
    });
    registry.set(viewSize, { width: 560, height: 800 });
    expect(registry.get(model.placement)).toEqual({
      preview: "below",
      fields: "popover",
    });
    // Resizing the view moves the panels; what the reader chose stands.
    expect(registry.get(model.panels)).toBe(panels);
  });

  it("opens the Fields action's column in a wide view and its picker in a narrow one", () => {
    const viewSize = Atom.make<ViewSize | null>({ width: 1200, height: 800 });
    using opened = open({ viewSize });
    const { registry, model } = opened;
    expect(registry.get(model.fieldsAction)).toEqual({
      opens: "column",
      open: false,
    });
    registry.set(model.fieldsAction, undefined);
    expect(registry.get(model.panels).fields.shown).toBe(true);
    expect(registry.get(model.fieldsAction)).toEqual({
      opens: "column",
      open: true,
    });
    registry.set(viewSize, { width: 560, height: 800 });
    // The column does not fit: the action opens the picker, and the panel
    // keeps its shown flag for a wider view.
    expect(registry.get(model.fieldsAction)).toEqual({
      opens: "popover",
      open: false,
    });
    registry.set(model.fieldsAction, undefined);
    expect(registry.get(model.fieldsPicker)).toBe(true);
    expect(registry.get(model.fieldsAction).open).toBe(true);
    registry.set(model.fieldsAction, undefined);
    expect(registry.get(model.fieldsPicker)).toBe(false);
    expect(registry.get(model.panels).fields.shown).toBe(true);
  });

  it("closes the Fields picker when the view widens, and leaves it closed when it narrows again", () => {
    const viewSize = Atom.make<ViewSize | null>({ width: 560, height: 800 });
    using opened = open({ viewSize });
    const { registry, model } = opened;
    registry.set(model.fieldsAction, undefined);
    expect(registry.get(model.fieldsPicker)).toBe(true);
    registry.set(viewSize, { width: 1200, height: 800 });
    expect(registry.get(model.fieldsPicker)).toBe(false);
    registry.set(viewSize, { width: 560, height: 800 });
    expect(registry.get(model.fieldsPicker)).toBe(false);
  });

  it("draws a panel at most two fifths of its container, within the limits", () => {
    expect(panelLimit(1000)).toBe(400);
    expect(panelLimit(400)).toBe(PANEL_WIDTH.min);
    expect(panelLimit(4000)).toBe(PANEL_WIDTH.max);
  });
});

describe("the annotation result", () => {
  it("is the render's result while it is for the chosen example", async () => {
    using opened = open();
    const { registry, model, host } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    load(opened);
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[1]!.id));
    registry.set(model.scheduler.run, undefined);
    (await started(host)).answer({});
    await vi.waitFor(() =>
      expect(registry.get(model.scheduler.state).result).not.toBeNull(),
    );
    expect(registry.get(model.annotationResult)).toBe(
      registry.get(model.scheduler.state).result,
    );
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[2]!.id));
    expect(registry.get(model.annotationResult)).toBeNull();
  });
});

describe("the reader's choices", () => {
  it("names a Sample Annotation alone, with its own paper, while no Item is chosen", () => {
    using opened = open();
    const { registry, model } = opened;
    const sample = SAMPLE_ANNOTATIONS[2]!;
    registry.update(model.choices, chooseAnnotation(sample.id));
    expect(registry.get(model.examples)).toEqual({
      current: [],
      example: sample,
    });
    expect(registry.get(model.snapshot)?.item.indexedKey).toBe(
      (sample.root.parentItem as { indexedKey: string }).indexedKey,
    );
  });

  it("offers a chosen Item's annotations once its data is read, and the first when the id is not its own", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.update(model.view, chooseItem(CHOICE));
    registry.update(model.choices, chooseAnnotation("missing"));
    expect(registry.get(model.examples)).toEqual({
      current: [],
      example: null,
    });
    load(opened);
    const { current, example } = registry.get(model.examples);
    expect(current.length).toBe(PAPER.roots.annotations.length);
    expect(example).toBe(current[0] ?? SAMPLE_ANNOTATIONS[0]);
  });

  it("reads no Citation set or partial for a Profile", () => {
    using opened = open();
    const { registry, model } = opened;
    expect(registry.get(model.citation)).toBeNull();
    expect(registry.get(model.partial)).toBeNull();
  });

  it("keeps the same Citation set when another choice changes", () => {
    using opened = open({ kind: "citation" });
    const { registry, model } = opened;
    const before = registry.get(model.citation);
    registry.update(model.choices, setPreview({ showMarkdown: true }));
    registry.update(model.choices, chooseAnnotation(SAMPLE_ANNOTATIONS[1]!.id));
    expect(registry.get(model.citation)).toBe(before);
  });

  it("stands the built-in Citation example down when the reader picks an Item for a citation", () => {
    using opened = open({ kind: "citation" });
    const { registry, model } = opened;
    registry.update(model.view, setRoot("citation"));
    registry.set(model.pick, CHOICE);
    expect(registry.get(model.item)).toEqual(CHOICE);
    expect(registry.get(model.choices).citationExample).toBeNull();
  });

  it("keeps the built-in Citation example when the reader picks an Item elsewhere", () => {
    using opened = open();
    const { registry, model } = opened;
    registry.set(model.pick, CHOICE);
    expect(registry.get(model.choices).citationExample).toBe("one-item");
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
