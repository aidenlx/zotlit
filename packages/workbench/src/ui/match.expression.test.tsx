import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

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
