import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MatchExpressionInput } from "./match.expression";
import type { FaultSpan } from "./match.expression";
import { WorkbenchThemeProvider } from "./theme";

afterEach(cleanup);

it("colors a method name with the function hook and its receiver with the property hook", () => {
  const { container } = render(
    <MatchExpressionInput value="title.lower()" onChange={() => {}} />,
  );
  const tokens = (hook: string) =>
    [...container.querySelectorAll(`.${hook}`)].map((node) => node.textContent);
  expect(tokens("zt-template-filter")).toEqual(["lower"]);
  expect(tokens("zt-template-property")).toEqual(["title"]);
});

it("mounts the extension the theme supplies for expression editors", () => {
  const { container } = render(
    <WorkbenchThemeProvider
      theme={{
        expressionExtension: EditorView.editorAttributes.of({
          class: "host-expression",
        }),
      }}
    >
      <MatchExpressionInput value="itemType == 'book'" onChange={() => {}} />
    </WorkbenchThemeProvider>,
  );
  expect(
    container
      .querySelector(".cm-editor")
      ?.classList.contains("host-expression"),
  ).toBe(true);
});

// The look of the underline, and that no tooltip shows over it, are proved
// in the running app (query-view e2e).
it("holds the faults it is given as error ranges, and clears them", () => {
  const text = "lower(title) == 'book";
  const field = (faults: readonly FaultSpan[]) => (
    <MatchExpressionInput value={text} onChange={() => {}} faults={faults} />
  );
  const mounted = render(field([{ from: 16, to: 21 }]));
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector(".cm-editor")!,
  )!;
  const marked = () => {
    const found: { text: string; severity: string }[] = [];
    forEachDiagnostic(editor.state, ({ severity }, from, to) => {
      found.push({ text: editor.state.sliceDoc(from, to), severity });
    });
    return found;
  };
  expect(marked()).toEqual([{ text: "'book", severity: "error" }]);
  act(() => mounted.rerender(field([])));
  expect(marked()).toEqual([]);
});
