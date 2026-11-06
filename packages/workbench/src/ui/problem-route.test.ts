import type { RenderDiagnostic } from "#/render/result";
import { describe, expect, it } from "vitest";

import { INITIAL_VIEW } from "./model";
import type { WorkbenchViewState } from "./model";
import { routeDiagnosis, routeProblem } from "./problem-route";
import type { WorkbenchDiagnosis } from "./problems";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

const profile = () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);

/** The reader somewhere else: on Advanced, a row open, a field focused. */
const AWAY: WorkbenchViewState = {
  ...INITIAL_VIEW,
  tab: "match",
  advanced: true,
  root: "filename",
  presentation: {
    ...INITIAL_VIEW.presentation,
    selected: 4,
    reveal: { from: 1, to: 2 },
    fieldFocus: { field: "folder" },
  },
};

const render = (diagnostic: Partial<RenderDiagnostic>): WorkbenchDiagnosis => {
  const full = { code: "render-error", ...diagnostic } as RenderDiagnostic;
  return { id: "r", kind: "render", diagnostic: full, occurrences: [full] };
};

describe("problem-to-pane routing", () => {
  it("opens a Properties row on the text the problem names", () => {
    const next = routeProblem(
      { slice: "entry:2", range: { from: 5, to: 9 } },
      profile(),
    )(AWAY);
    expect(next).toMatchObject({
      advanced: false,
      tab: "properties",
      root: "note",
      presentation: {
        selected: 2,
        reveal: { from: 5, to: 9 },
        fieldFocus: null,
      },
    });
  });

  it("opens the Annotation tab at its section for a missing section", () => {
    const controller = new WorkbenchDocumentController("---\nid: x\n---\nBody");
    const next = routeProblem(
      { code: "missing-annotation-section", slice: "note" },
      controller,
    )(AWAY);
    expect(next).toMatchObject({
      advanced: false,
      tab: "annotation",
      root: "annotation",
      presentation: { reveal: null },
    });
  });

  it("puts the caret at the annotation section when the problem names no text", () => {
    const controller = profile();
    const { from } = controller.annotationSection!.source;
    const next = routeProblem({ slice: "annotation" }, controller)(AWAY);
    expect(next.presentation.reveal).toEqual({ from, to: from });
    expect(next.tab).toBe("annotation");
  });

  it("focuses the Name and folder control a details problem names", () => {
    const next = routeProblem(
      {
        slice: "details",
        params: { field: "folder" },
        range: { from: 0, to: 3 },
      },
      profile(),
    )(AWAY);
    expect(next).toMatchObject({
      tab: "name",
      advanced: false,
      presentation: { reveal: null, fieldFocus: { field: "folder" } },
    });
  });

  it("opens Advanced on the text an Advanced problem names, keeping the tab", () => {
    const next = routeProblem(
      { slice: "advanced", range: { from: 0, to: 3 } },
      profile(),
    )({ ...AWAY, advanced: false });
    expect(next).toMatchObject({
      advanced: true,
      tab: "match",
      root: "note",
      presentation: { reveal: { from: 0, to: 3 } },
    });
  });

  it("reveals a new object each time, so the same problem reveals again", () => {
    const route = routeProblem(
      { slice: "note", range: { from: 0, to: 3 } },
      profile(),
    );
    const first = route(AWAY).presentation.reveal;
    expect(route(AWAY).presentation.reveal).not.toBe(first);
  });

  it("leaves a plain document's tabs and only reveals", () => {
    const controller = new WorkbenchDocumentController("Body", {
      kind: "citation",
    });
    const next = routeProblem(
      { slice: "source", range: { from: 0, to: 2 } },
      controller,
    )(AWAY);
    expect(next).toEqual({
      ...AWAY,
      presentation: { ...AWAY.presentation, reveal: { from: 0, to: 2 } },
    });
  });

  it("opens the row a render failure names, with no text selected", () => {
    const next = routeDiagnosis(render({ position: 3 }), profile())!(AWAY);
    expect(next).toMatchObject({
      tab: "properties",
      advanced: false,
      presentation: { selected: 3, reveal: null },
    });
  });

  it("puts the caret at the start of the note name for a note name failure", () => {
    const controller = profile();
    const { from } = controller.sliceRange("filename");
    const next = routeDiagnosis(render({ part: "filename" }), controller)!(
      AWAY,
    );
    expect(next).toMatchObject({
      tab: "name",
      root: "filename",
      advanced: false,
      presentation: { reveal: { from, to: from } },
    });
  });

  it("puts the caret at the annotation section for an annotation failure", () => {
    const controller = profile();
    const { from } = controller.annotationSection!.source;
    const next = routeDiagnosis(render({ part: "annotation" }), controller)!(
      AWAY,
    );
    expect(next).toMatchObject({
      tab: "annotation",
      root: "annotation",
      presentation: { reveal: { from, to: from } },
    });
  });

  it("opens Advanced with no reveal for a failure that names no part", () => {
    const next = routeDiagnosis(render({}), profile())!({
      ...AWAY,
      advanced: false,
      presentation: { ...AWAY.presentation, reveal: null },
    });
    expect(next).toMatchObject({
      advanced: true,
      root: "note",
      presentation: { reveal: null },
    });
  });

  it("opens the pane whose region holds a verified call", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace(
        "# {{ zt.title }}",
        '# {{ zt.title }}\n{% render "missing-bit" %}',
      ),
    );
    const from = controller.source.indexOf('{% render "missing-bit" %}');
    const next = routeDiagnosis(
      render({
        code: "missing-partial",
        params: { name: "missing-bit" },
        callSite: { from: 0, to: 1 },
      }),
      controller,
    )!(AWAY);
    expect(next).toMatchObject({
      tab: "note",
      advanced: false,
      root: "note",
      presentation: { reveal: { from } },
    });
  });

  it("answers null for a call the source no longer holds", () => {
    expect(
      routeDiagnosis(
        render({
          code: "missing-partial",
          params: { name: "gone" },
          callSite: { from: 0, to: 1 },
        }),
        profile(),
      ),
    ).toBeNull();
  });
});
