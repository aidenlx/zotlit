import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import type { MatchTree } from "@zotlit/templates/facade";

import { WorkbenchHostProvider } from "./host";
import { MatchEditor } from "./match";
import { filterVocabulary } from "./match.fields";
import { fakeHost } from "./test-host";
import { m } from "./test-messages";

afterEach(cleanup);

const vocabulary = filterVocabulary("annotations", {
  m,
  values: { tags: [], collections: [], libraries: [] },
});

// #1651: the owner renders each kept filter at once, but the editor reads
// that render's value in an effect, which can run after the user typed again.
it("keeps the row the user is typing in when the owner gives back an older filter it sent", () => {
  const host = fakeHost();
  const editor = (value: MatchTree) => (
    <WorkbenchHostProvider host={host}>
      <MatchEditor
        value={value}
        vocabulary={vocabulary}
        onChange={() => true}
      />
    </WorkbenchHostProvider>
  );
  const mounted = render(editor({ and: ["te"] }));
  const field = () =>
    mounted.container.querySelector<HTMLElement>(".cm-content");
  const content = field()!;
  const view = EditorView.findFromDOM(content)!;
  const type = (text: string) =>
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: text },
        selection: { anchor: view.state.doc.length + text.length },
        userEvent: "input.type",
      }),
    );
  type("xt");
  type(".");
  // The owner's render of the first edit lands after the second.
  act(() => mounted.rerender(editor({ and: ["text"] })));
  expect(field()).toBe(content);
  expect(view.state.doc.toString()).toBe("text.");
  act(() => mounted.rerender(editor({ and: ["text."] })));
  expect(field()).toBe(content);
  expect(view.state.doc.toString()).toBe("text.");
  // A filter of the owner's own replaces the rows.
  act(() => mounted.rerender(editor({ and: ["comment"] })));
  expect(mounted.container.textContent).toContain("comment");
});
