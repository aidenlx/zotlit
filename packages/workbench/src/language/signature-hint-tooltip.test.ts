// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vitest";

import { filterExpressionLanguage } from "./filter-expression";
import { SIGNATURE_HINT_CLASS, signatureHint } from "./signature-hint";

/** A focused Filter Expression editor over `doc` with the Signature Hint. */
async function editor(doc: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  // CodeMirror tells its extensions of a focus change in a later task; each
  // change resolves the next wait.
  let focusChanged = Promise.withResolvers<void>();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        filterExpressionLanguage,
        signatureHint({ receiverType: () => "string" }),
        EditorView.updateListener.of((update) => {
          if (!update.focusChanged) return;
          focusChanged.resolve();
          focusChanged = Promise.withResolvers();
        }),
      ],
    }),
  });
  // happy-dom reports a document without focus, which CodeMirror reads as
  // an editor without focus.
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const focused = focusChanged.promise;
  view.focus();
  await focused;
  return {
    view,
    caret(pos: number) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
    },
    async blur() {
      const blurred = focusChanged.promise;
      view.contentDOM.blur();
      await blurred;
    },
    hint: () => parent.querySelector<HTMLElement>(`.${SIGNATURE_HINT_CLASS}`),
    [Symbol.dispose]() {
      view.destroy();
      hasFocus.mockRestore();
      parent.remove();
    },
  };
}

it("shows the signature with the parameter at the caret marked and the description beneath", async () => {
  using field = await editor("title.slice(1, )");
  field.caret("title.slice(1, ".length);

  const hint = field.hint();
  expect(hint?.querySelector("code")?.textContent).toBe(
    "slice(start: number, end?: number) → string",
  );
  expect(hint?.querySelector("mark")?.textContent).toBe("end?: number");
  expect(hint?.textContent).toContain(
    "The part of the text from index start up to",
  );
});

it("moves the mark as the caret moves to another argument", async () => {
  using field = await editor("title.slice(1, 2)");
  field.caret("title.slice(".length);
  expect(field.hint()?.querySelector("mark")?.textContent).toBe(
    "start: number",
  );
  field.caret("title.slice(1, ".length);
  expect(field.hint()?.querySelector("mark")?.textContent).toBe("end?: number");
});

it("closes when the caret leaves the call", async () => {
  using field = await editor("title.slice(1, 2) + 1");
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
  field.caret("title.slice(1, 2) +".length);
  expect(field.hint()).toBeNull();
});

it("closes when the editor loses focus", async () => {
  using field = await editor("title.slice(1, 2)");
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
  await field.blur();
  expect(field.hint()).toBeNull();
});
