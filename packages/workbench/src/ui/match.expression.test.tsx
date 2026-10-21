import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MatchExpressionInput } from "./match.expression";

afterEach(cleanup);

it("offers no completion without a vocabulary", () => {
  const { container } = render(
    <MatchExpressionInput value="mi" onChange={() => {}} />,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  view.dispatch({ selection: { anchor: 2 } });
  startCompletion(view);
  // A list that would open stands pending from the request on.
  expect(completionStatus(view.state)).toBeNull();
});

/** The text each underline of the field marks, and how it marks it. */
const marks = (container: HTMLElement) => {
  const editor = EditorView.findFromDOM(
    container.querySelector(".cm-editor")!,
  )!;
  const found: { text: string; severity: string }[] = [];
  forEachDiagnostic(editor.state, ({ severity }, from, to) => {
    found.push({ text: editor.state.sliceDoc(from, to), severity });
  });
  return found;
};

// A Syntax Fault as it is typed, the run's Fault on the text it planned and
// not on another, the look of the underline, and that no tooltip shows over
// it, are proved in the running app (query-view and query-view-properties
// e2e).
it("underlines nothing in an empty text, which the owner explains", () => {
  const { container } = render(
    <MatchExpressionInput value="" onChange={() => {}} />,
  );
  expect(marks(container)).toEqual([]);
});

it("underlines the Syntax Fault over a run's Fault of the same text", () => {
  const text = "title.nope(";
  const { container } = render(
    <MatchExpressionInput
      value={text}
      onChange={() => {}}
      fault={{ text, span: { from: 6, to: 10 } }}
    />,
  );
  expect(marks(container)).toEqual([{ text: "(", severity: "error" }]);
});

it("keeps what the user typed when the owner gives back an older text it sent", () => {
  const field = (value: string) => (
    <MatchExpressionInput value={value} onChange={() => {}} />
  );
  const mounted = render(field("a"));
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector(".cm-editor")!,
  )!;
  const type = (text: string) =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: text },
      selection: { anchor: editor.state.doc.length + text.length },
      userEvent: "input.type",
    });
  type("b");
  type("c");
  // The owner's render of the first edit lands after the second.
  act(() => mounted.rerender(field("ab")));
  expect(editor.state.doc.toString()).toBe("abc");
  expect(editor.state.selection.main.head).toBe(3);
  act(() => mounted.rerender(field("abc")));
  // A text of the owner's own replaces the field's.
  act(() => mounted.rerender(field("x")));
  expect(editor.state.doc.toString()).toBe("x");
});
