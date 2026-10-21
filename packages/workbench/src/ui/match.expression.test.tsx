import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, expect, it, onTestFinished } from "vitest";

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

it("keeps what the user typed when the next key lands before the owner's render settles", async () => {
  // The browser's own scheduling, which `act` would replace by flushing
  // every effect before the next key.
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const acting = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = false;
  onTestFinished(() => {
    scope.IS_REACT_ACT_ENVIRONMENT = acting;
  });
  // An owner that keeps each text as its state at once, as a Match row and
  // the Formula page do, and announces each render it commits.
  const commits: ((value: string) => void)[] = [];
  const committed = () => new Promise<string>((done) => commits.push(done));
  let set: (value: string) => void = () => {};
  function Owner() {
    const [value, setValue] = useState("a");
    set = setValue;
    useLayoutEffect(() => {
      for (const commit of commits.splice(0)) commit(value);
    }, [value]);
    return <MatchExpressionInput value={value} onChange={setValue} />;
  }
  const mounted = render(<Owner />);
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector<HTMLElement>('[role="textbox"]')!,
  )!;
  const type = (text: string) =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: text },
      selection: { anchor: editor.state.doc.length + text.length },
      userEvent: "input.type",
    });
  const echo = committed();
  type("b");
  expect(await echo).toBe("ab");
  const next = committed();
  type("c");
  expect(await next).toBe("abc");
  expect(editor.state.doc.toString()).toBe("abc");
  expect(editor.state.selection.main.head).toBe(3);
  // A text of the owner's own replaces the field's.
  act(() => set("x"));
  expect(editor.state.doc.toString()).toBe("x");
});
