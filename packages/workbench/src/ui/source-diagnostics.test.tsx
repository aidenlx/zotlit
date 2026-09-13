import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { workbenchDiagnoses } from "./problems";
import { SliceEditor } from "./slice-editor";
import { WorkbenchDiagnosticsProvider } from "./source-diagnostics";
import { renderWithMessages as render } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
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
