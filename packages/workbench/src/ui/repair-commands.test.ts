import type { RenderDiagnostic } from "#/render/result";
import * as Atom from "effect/reactivity/Atom";
import { describe, expect, it } from "vitest";

import { INITIAL_PANELS } from "./panel-layout";
import type { ViewSize, WorkbenchPanels } from "./panel-layout";
import { renderDiagnosis } from "./problems";
import type { WorkbenchDiagnosis } from "./problems";
import { repairCommands } from "./repair-commands";
import { mount } from "./test-host";
import { m } from "./test-messages";

import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

const BOTH: WorkbenchPanels = {
  fields: { ...INITIAL_PANELS.fields, shown: true },
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

/** A view too narrow for the Fields column, so the Fields action opens the picker. */
const NARROW: ViewSize = { width: 560, height: 800 };

/** The reader on Advanced with the Fields picker open over the editor. */
function open({
  source,
  diagnoses = [],
}: {
  source?: string;
  diagnoses?: readonly WorkbenchDiagnosis[];
} = {}) {
  const mounted = mount(null, {
    ...(source === undefined ? {} : { source }),
    state: { advanced: true, tab: "name" },
    panels: BOTH,
    viewSize: Atom.make<ViewSize | null>(NARROW),
  });
  const { registry, model, controller, host } = mounted;
  registry.mount(model.fieldsPicker);
  registry.set(model.fieldsPicker, { query: "ti" });
  expect(registry.get(model.fieldsPicker)).not.toBeNull();
  const selected: string[] = [];
  const opened: boolean[] = [];
  const commands = repairCommands({
    registry,
    model,
    controller,
    host,
    problems: {
      diagnoses,
      select: (id) => void selected.push(id),
      setOpen: (next) => void opened.push(next),
    },
  });
  return Object.assign(mounted, {
    commands,
    selected,
    opened,
    view: () => registry.get(model.view),
    picker: () => registry.get(model.fieldsPicker),
    panels: () => registry.get(model.panels),
  });
}

const failure = (diagnostic: Partial<RenderDiagnostic>): RenderDiagnostic => ({
  code: "render-error",
  ...diagnostic,
});

const diagnosis = (diagnostic: RenderDiagnostic): WorkbenchDiagnosis => ({
  id: renderDiagnosis(diagnostic).id,
  kind: "render",
  diagnostic,
  occurrences: [diagnostic],
});

/** The default Profile with one call to a partial no vault holds, in the note. */
const MISSING_CALL = DEFAULT_PROFILE_SOURCE.replace(
  "# {{ zt.title }}",
  '# {{ zt.title }}\n{% render "missing-bit" %}',
);
const missingCall = failure({
  code: "missing-partial",
  params: { name: "missing-bit" },
  callSite: { from: 0, to: 1 },
});

describe("the repair commands", () => {
  it("open the annotation box on its section and close the Fields picker, keeping the panels", () => {
    using page = open();
    page.commands.openAnnotationBox();
    const section = page.controller.annotationSection!;
    expect(page.view()).toMatchObject({
      advanced: false,
      tab: "annotation",
      root: "annotation",
      presentation: {
        reveal: { from: section.source.from, to: section.source.from },
      },
    });
    expect(page.picker()).toBeNull();
    expect(page.panels()).toEqual(BOTH);
  });

  it("insert the annotation loop, report the section they added, and return to the Note tab at its end", () => {
    const header = "--- zotlit:annotation ---";
    using page = open({
      source: DEFAULT_PROFILE_SOURCE.slice(
        0,
        DEFAULT_PROFILE_SOURCE.indexOf(header),
      ),
    });
    page.commands.insertAnnotationLoop();
    const text = page.controller.source;
    const loop = "{% endfor %}\n";
    const end = text.lastIndexOf(loop) + loop.length;
    expect(text.slice(end)).toBe(`${header}\n`);
    expect(page.view()).toMatchObject({
      advanced: false,
      tab: "note",
      root: "note",
      presentation: { reveal: { from: end, to: end } },
    });
    expect(page.host.calls.notices).toEqual([
      m.workbench_annotation_section_added(),
    ]);
    expect(page.picker()).toBeNull();
    expect(page.panels()).toEqual(BOTH);
  });

  it("insert the annotation loop in a section that stands without a notice", () => {
    using page = open();
    page.commands.insertAnnotationLoop();
    expect(page.view()).toMatchObject({ advanced: false, tab: "note" });
    expect(page.host.calls.notices).toEqual([]);
  });

  it("return to the template at the place the reader left, over the picker", () => {
    using page = open();
    page.registry.update(page.model.view, (state) => ({
      ...state,
      presentation: {
        ...state.presentation,
        selection: { slice: "advanced" as const, range: { from: 10, to: 14 } },
      },
    }));
    page.commands.returnToTemplate();
    expect(page.view()).toMatchObject({
      advanced: true,
      tab: "name",
      presentation: { reveal: { from: 10, to: 14, slice: "advanced" } },
    });
    expect(page.picker()).toBeNull();
  });

  it("return to the start of the template when the reader left no place", () => {
    using page = open();
    page.commands.returnToTemplate();
    expect(page.view().presentation.reveal).toEqual({ from: 0, to: 0 });
  });

  it("open a diagnosis on the call it names, over the picker", () => {
    using page = open({ source: MISSING_CALL });
    page.commands.openDiagnosis(diagnosis(missingCall));
    const from = page.controller.source.indexOf('{% render "missing-bit" %}');
    expect(page.view()).toMatchObject({
      advanced: false,
      tab: "note",
      presentation: { reveal: { from } },
    });
    expect(page.picker()).toBeNull();
    expect(page.panels()).toEqual(BOTH);
  });

  it("open a diagnosis on an entry's row", () => {
    using page = open();
    page.commands.openDiagnosis(diagnosis(failure({ position: 2 })));
    expect(page.view()).toMatchObject({
      advanced: false,
      tab: "properties",
      presentation: { selected: 2 },
    });
  });

  it("say so when the call a diagnosis names has left the source", () => {
    using page = open();
    page.commands.openDiagnosis(diagnosis(missingCall));
    expect(page.host.calls.notices).toEqual([
      m.workbench_problems_location_unknown(),
    ]);
    expect(page.view()).toMatchObject({ advanced: true, tab: "name" });
  });

  it("show a preview's problem in the Problems area and reveal its call in the editor", () => {
    const found = diagnosis(missingCall);
    using page = open({ source: MISSING_CALL, diagnoses: [found] });
    page.commands.showProblem(missingCall);
    expect(page.selected).toEqual([found.id]);
    const from = page.controller.source.indexOf('{% render "missing-bit" %}');
    expect(page.view()).toMatchObject({
      advanced: false,
      tab: "note",
      presentation: { reveal: { from } },
    });
    expect(page.picker()).toBeNull();
    expect(page.panels()).toEqual(BOTH);
  });

  it("show a problem with no known place in the Problems area and leave the editor where it is", () => {
    const unplaced = failure({ part: "render" });
    using page = open({ diagnoses: [diagnosis(unplaced)] });
    page.commands.showProblem(unplaced);
    expect(page.selected).toEqual([renderDiagnosis(unplaced).id]);
    expect(page.view()).toMatchObject({
      advanced: true,
      tab: "name",
      presentation: { reveal: null },
    });
    expect(page.host.calls.notices).toEqual([]);
  });

  it("open the Problems area on a document the parser refused", () => {
    using page = open();
    page.commands.showProblem(null);
    expect(page.opened).toEqual([true]);
    expect(page.picker()).toBeNull();
  });
});
