import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MatchExpressionInput } from "./match.expression";
import type { ExpressionFault } from "./match.expression";
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

it("underlines the faults it is given, with no lint tooltip, and clears them", async () => {
  const text = "lower(title) == 'book";
  const field = (faults: readonly ExpressionFault[]) => (
    <MatchExpressionInput value={text} onChange={() => {}} faults={faults} />
  );
  const mounted = render(
    field([{ from: 16, to: 21, message: "The string has no closing quote." }]),
  );
  const editor = EditorView.findFromDOM(
    mounted.container.querySelector(".cm-editor")!,
  )!;
  const marked: string[] = [];
  forEachDiagnostic(editor.state, (_diagnostic, from, to) => {
    marked.push(editor.state.sliceDoc(from, to));
  });
  expect(marked).toEqual(["'book"]);
  const mark = mounted.container.querySelector(".cm-lintRange-error")!;
  expect(mark.textContent).toBe("'book");
  fireEvent.mouseMove(mark);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const tooltip = mounted.container.querySelector(".cm-tooltip-lint");
  expect(tooltip === null || getComputedStyle(tooltip).display === "none").toBe(
    true,
  );
  expect(mounted.container.querySelector(".cm-gutters")).toBeNull();
  act(() => mounted.rerender(field([])));
  expect(mounted.container.querySelector(".cm-lintRange-error")).toBeNull();
});
