import type { Span } from "#/language/span";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import {
  ExpressionTypesProvider,
  MatchExpressionInput,
} from "./match.expression";
import { WorkbenchThemeProvider } from "./theme";

import { documentFocus } from "#/language/test-utils";

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

it("shows the Signature Hint of the method at the caret, typed as the host types it", () => {
  using _focus = documentFocus();
  const { container } = render(
    <ExpressionTypesProvider
      types={{
        receiverType: (text) => (text === "title" ? "string" : undefined),
      }}
    >
      <MatchExpressionInput value="title.slice(1, )" onChange={() => {}} />
    </ExpressionTypesProvider>,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  view.focus();
  view.dispatch({ selection: { anchor: "title.slice(1, ".length } });
  const hint = container.querySelector(".zt-signature-hint")!;
  expect(hint.querySelector("mark")?.textContent).toBe("end?: number");
  expect(hint.textContent).toContain("The part of the text");
  expect(hint.textContent).not.toContain("The elements of the list");
});

// The look of the underline, and that no tooltip shows over it, are proved
// in the running app (query-view e2e).
it("holds the faults it is given as error ranges, and clears them", () => {
  const text = "lower(title) == 'book";
  const field = (faults: readonly Span[]) => (
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
