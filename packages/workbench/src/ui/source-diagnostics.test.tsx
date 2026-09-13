import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { workbenchDiagnoses } from "./problems";
import { ProblemsFooter, useWorkbenchProblems } from "./problems-footer";
import { SliceEditor } from "./slice-editor";
import { WorkbenchDiagnosticsProvider } from "./source-diagnostics";
import { renderWithMessages as render } from "./test-host";

import { entrySlice, WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

it("shows a verified error without a reveal and clears it after repair", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const source = controller.sliceText("note");
  const from = controller.sliceRange("note").from;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "render-error",
        message: "Broken template",
        sourceSite: { source, offset: from, from: from + 2, to: from + 4 },
      },
    ],
  );
  const pane = (findings = diagnoses) => (
    <WorkbenchDiagnosticsProvider value={findings}>
      <SliceEditor controller={controller} slice="note" label="Note" />
    </WorkbenchDiagnosticsProvider>
  );
  const mounted = render(pane());
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector(".cm-editor")!,
  )!;
  const found: { from: number; to: number; severity: string }[] = [];
  forEachDiagnostic(editor.state, (diagnostic, start, end) => {
    found.push({ from: start, to: end, severity: diagnostic.severity });
  });
  expect(found).toEqual([{ from: 2, to: 4, severity: "error" }]);
  expect(mounted.container.querySelector(".cm-lintRange-error")).not.toBeNull();
  expect(editor.state.selection.main.head).toBe(0);
  expect(editor.hasFocus).toBe(false);
  expect(editor.contentDOM.getAttribute("aria-invalid")).toBe("true");
  act(() => mounted.rerender(pane([])));
  expect(mounted.container.querySelector(".cm-lintRange-error")).toBeNull();
  expect(editor.contentDOM.getAttribute("aria-invalid")).toBe("false");
});

it("opens Problems from the red dot and leaves underlined text editable", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const source = controller.sliceText("note");
  const offset = controller.sliceRange("note").from;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "render-error",
        message: "First failure",
        sourceSite: { source, offset, from: offset + 2, to: offset + 4 },
      },
      {
        code: "render-error",
        message: "Second failure",
        sourceSite: {
          source,
          offset,
          from: offset + source.indexOf("[Zotero]"),
          to: offset + source.indexOf("[Zotero]") + 8,
        },
      },
    ],
  );
  function Workbench() {
    const problems = useWorkbenchProblems({
      diagnoses,
      trigger: null,
      attempt: 1,
    });
    return (
      <WorkbenchDiagnosticsProvider
        value={diagnoses}
        onReveal={problems.select}
      >
        <SliceEditor controller={controller} slice="note" label="Note" />
        <ProblemsFooter problems={problems} onOpen={() => {}} />
      </WorkbenchDiagnosticsProvider>
    );
  }
  const mounted = render(<Workbench />);

  const marks = mounted.container.querySelectorAll(".cm-lintRange-error");
  expect(marks.length).toBe(2);
  fireEvent.click(marks[1]!);
  expect(
    mounted.queryByRole("button", { name: "Return to template" }),
  ).toBeNull();
  const dots = mounted.container.querySelectorAll(".cm-problem-button");
  expect(dots.length).toBe(2);
  expect(dots[1]!.getAttribute("aria-label")).toBe("Show problem");
  fireEvent.click(dots[1]!);
  expect(
    mounted.container.querySelector('[data-part="problems-text"]')?.textContent,
  ).toBe("Second failure");
  expect(mounted.queryByText("First failure")).toBeNull();
  expect(
    mounted.getByRole("button", { name: "Return to template" }),
  ).toBeTruthy();
});

it("keeps the gutter column out of a pane with nothing wrong", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const source = controller.sliceText("note");
  const from = controller.sliceRange("note").from;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "render-error",
        message: "Broken template",
        sourceSite: { source, offset: from, from: from + 2, to: from + 4 },
      },
    ],
  );
  const pane = (findings: typeof diagnoses) => (
    <WorkbenchDiagnosticsProvider value={findings}>
      <SliceEditor controller={controller} slice="note" label="Note" />
    </WorkbenchDiagnosticsProvider>
  );
  const mounted = render(pane([]));
  const column = () => mounted.container.querySelector(".cm-problem-gutter");
  expect(column()).toBeNull();
  expect(mounted.container.querySelector(".cm-gutters")).toBeNull();
  act(() => mounted.rerender(pane(diagnoses)));
  expect(column()).not.toBeNull();
  expect(mounted.container.querySelectorAll(".cm-problem-button").length).toBe(
    1,
  );
  act(() => mounted.rerender(pane([])));
  expect(column()).toBeNull();
  expect(mounted.container.querySelector(".cm-gutters")).toBeNull();
});

it("leaves the Advanced pane its line numbers when nothing is wrong", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const mounted = render(
    <WorkbenchDiagnosticsProvider value={[]}>
      <SliceEditor controller={controller} slice="advanced" label="Source" />
    </WorkbenchDiagnosticsProvider>,
  );
  expect(mounted.container.querySelector(".cm-lineNumbers")).not.toBeNull();
  expect(mounted.container.querySelector(".cm-problem-gutter")).toBeNull();
});

it("underlines the expression a property rule failed on, in the row's own editor", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  // The fourth row is the built-in JSON-e rule `{"$eval":"zt.citationKey"}`.
  const slice = entrySlice(4);
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "property-error",
        params: { key: "citekey", detail: 'object has no property "nope"' },
        part: "properties",
        position: 4,
        sliceSite: {
          kind: "path",
          path: [],
          source: '{"$eval":"zt.citationKey"}',
        },
      },
    ],
  );
  const mounted = render(
    <WorkbenchDiagnosticsProvider value={diagnoses}>
      <SliceEditor
        controller={controller}
        slice={slice}
        label="Value"
        language="json-e"
      />
    </WorkbenchDiagnosticsProvider>,
  );
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector(".cm-editor")!,
  )!;
  const marked: string[] = [];
  forEachDiagnostic(editor.state, (_diagnostic, start, end) => {
    marked.push(editor.state.sliceDoc(start, end));
  });
  expect(marked).toEqual(['"zt.citationKey"']);
  expect(mounted.container.querySelector(".cm-lintRange-error")).not.toBeNull();
});

it("leaves a property failure unmarked in another row's editor", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "property-error",
        params: { key: "citekey" },
        part: "properties",
        position: 4,
        sliceSite: {
          kind: "path",
          path: [],
          source: '{"$eval":"zt.citationKey"}',
        },
      },
    ],
  );
  const mounted = render(
    <WorkbenchDiagnosticsProvider value={diagnoses}>
      <SliceEditor
        controller={controller}
        slice={entrySlice(1)}
        label="Value"
      />
    </WorkbenchDiagnosticsProvider>,
  );
  expect(mounted.container.querySelector(".cm-lintRange-error")).toBeNull();
});
