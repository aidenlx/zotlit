// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";

import { applyTemplateCompletion } from "./completion";
import { suggestions } from "./suggestions";
import type { Suggestion } from "./suggestions";

const CALL = '{% render "';

/** The editor, the pinned "New partial…" option, and the flow's resolver. */
function newPartialCompletion(name: string | null) {
  const view = new EditorView({
    state: EditorState.create({
      doc: CALL,
      selection: { anchor: CALL.length },
    }),
    parent: document.body,
  });
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const result = suggestions(CALL, CALL.length, {
    root: "note",
    partials: [],
    createPartial: {
      label: "New partial…",
      detail: "Name a new partial, then insert the call.",
      run: () => promise,
    },
  })!;
  const option = result.options.find(
    (candidate): candidate is Suggestion =>
      candidate.category === "new-partial",
  )!;
  return {
    view,
    apply: () => applyTemplateCompletion(view, result, option),
    settle: async () => {
      resolve(name);
      await promise;
      await Promise.resolve();
    },
    [Symbol.dispose]: () => view.destroy(),
  };
}

it("writes the created name into the call the completion was opened on", async () => {
  using flow = newPartialCompletion("venue-line");

  expect(flow.apply()).toBe(false);
  await flow.settle();

  expect(flow.view.state.doc.toString()).toBe(
    '{% render "venue-line" with zt as zt %}',
  );
});

it("leaves the source alone when the prompt is dismissed", async () => {
  using flow = newPartialCompletion(null);

  flow.apply();
  await flow.settle();

  expect(flow.view.state.doc.toString()).toBe(CALL);
});

it("reaches no DOM when the pane closed while the prompt was open", async () => {
  const flow = newPartialCompletion("venue-line");

  flow.apply();
  flow.view.destroy();

  await expect(flow.settle()).resolves.toBeUndefined();
});

it("drops the edit when the document changed under the prompt", async () => {
  using flow = newPartialCompletion("venue-line");

  flow.apply();
  flow.view.dispatch({ changes: { from: 0, insert: "Heading\n" } });
  await flow.settle();

  expect(flow.view.state.doc.toString()).toBe(`Heading\n${CALL}`);
});
