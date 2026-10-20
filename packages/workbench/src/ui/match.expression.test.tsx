import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  ExpressionTypesProvider,
  MatchExpressionInput,
} from "./match.expression";
import type { FaultSpan } from "./match.expression";
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

it("offers the completion of the vocabulary it is given, in the theme's presentation", async () => {
  const { container } = render(
    <WorkbenchThemeProvider
      theme={{ expressionCompletion: { tooltipClass: () => "host-list" } }}
    >
      <MatchExpressionInput
        value=""
        onChange={() => {}}
        completion={{
          fields: [{ path: "title", label: "Title" }],
          context: false,
          formulas: [],
        }}
      />
    </WorkbenchThemeProvider>,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  view.dispatch({
    changes: { from: 0, insert: "tit" },
    selection: { anchor: 3 },
    userEvent: "input.type",
  });
  const list = await vi.waitFor(() => {
    const found = document.querySelector(".cm-tooltip-autocomplete.host-list");
    if (!found) throw new Error("no list yet");
    return found;
  });
  expect(list.querySelector(".cm-completionLabel")?.textContent).toBe("title");
});

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
