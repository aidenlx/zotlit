import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";

import { useWorkbenchController } from "./editor";
import type { WorkbenchMatchResult } from "./host";
import { MatchPane } from "./match";
import { mount } from "./test-host";

afterEach(cleanup);

/** A Profile whose Match holds `conditions`, all of which must hold. */
const profile = (conditions: readonly string[]) => `---
name: Reading notes
id: reading
version: 1.0.0
contract: ${CONTRACT_VERSION}
filename: '{{ zt.citationKey }}'
language: liquid
match: ${JSON.stringify({ and: conditions })}
---
# {{ zt.title }}

--- zotlit:annotation ---
`;

/** The pane over the document the workbench edits. */
function Pane() {
  return <MatchPane controller={useWorkbenchController()} />;
}

/** The Profile Match of `conditions`, which tests the chosen Item by `matches`. */
function profileMatch(
  conditions: readonly string[],
  matches: (filter: string) => WorkbenchMatchResult,
) {
  const mounted = mount(<Pane />, {
    source: profile(conditions),
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  mounted.host.matchData.matches = (_, filter) =>
    Promise.resolve(matches(filter));
  return { mounted, pane: render(mounted.ui) };
}

/** The editor of the expression field in the `index`th condition row. */
const field = (container: HTMLElement, index: number) =>
  EditorView.findFromDOM(
    container
      .querySelectorAll("[data-condition-row]")
      [index]!.querySelector(".cm-editor")!,
  )!;

/** The text each underline of an editor marks. */
const underlined = (editor: EditorView) => {
  const found: string[] = [];
  forEachDiagnostic(editor.state, (_, from, to) => {
    found.push(editor.state.sliceDoc(from, to));
  });
  return found;
};

it("underlines the Syntax Fault of a condition", async () => {
  const { mounted, pane } = profileMatch(
    ['itemType == "book"', "title =="],
    () => ({
      kind: "problem",
      message: "The filter does not parse.",
    }),
  );
  using _mounted = mounted;
  await waitFor(() =>
    expect(
      pane.container.querySelectorAll("[data-condition-row]"),
    ).toHaveLength(2),
  );
  expect(underlined(field(pane.container, 1))).toEqual(["=="]);
});

it("underlines the Fault the test finds on its condition, until its text changes", async () => {
  const conditions = ['itemType == "book"', 'tags.contain("Read")'];
  const { mounted, pane } = profileMatch(conditions, (filter) => {
    const from = filter.indexOf("contain(");
    return from === -1
      ? { kind: "result", matched: false }
      : {
          kind: "problem",
          message: "contain is not a method of list.",
          span: { from, to: from + "contain".length },
        };
  });
  using _mounted = mounted;
  await waitFor(() =>
    expect(underlined(field(pane.container, 1))).toEqual(["contain"]),
  );
  const editor = field(pane.container, 1);
  act(() => {
    editor.dispatch({
      changes: { from: editor.state.doc.length - 1, insert: ", 1" },
    });
  });
  expect(underlined(field(pane.container, 1))).toEqual([]);
});
