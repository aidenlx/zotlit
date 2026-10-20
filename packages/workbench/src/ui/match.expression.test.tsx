import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import {
  ExpressionVocabularyProvider,
  MatchExpressionInput,
} from "./match.expression";
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

it("shows the Signature Hint of the method at the caret, typed by the vocabulary", async () => {
  // happy-dom reports a document without focus, which CodeMirror reads as
  // an editor without focus.
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  onTestFinished(() => hasFocus.mockRestore());
  const { container } = render(
    <ExpressionVocabularyProvider
      vocabulary={{
        receiverType: (text) => (text === "title" ? "string" : undefined),
      }}
    >
      <MatchExpressionInput value="title.slice(1, )" onChange={() => {}} />
    </ExpressionVocabularyProvider>,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  view.focus();
  view.dispatch({ selection: { anchor: "title.slice(1, ".length } });
  // CodeMirror tells its extensions of the focus in a later task.
  const hint = await vi.waitFor(() => {
    const found = container.querySelector(".zt-signature-hint");
    if (!found) throw new Error("No Signature Hint yet.");
    return found;
  });
  expect(hint.querySelector("mark")?.textContent).toBe("end?: number");
  expect(hint.textContent).toContain("The part of the text");
  expect(hint.textContent).not.toContain("The elements of the list");
});
