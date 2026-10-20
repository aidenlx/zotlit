// @vitest-environment happy-dom
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { expect, it, vi } from "vitest";

import { filterExpressionLanguage } from "./filter-expression";
import { SIGNATURE_HINT_CLASS, signatureHint } from "./signature-hint";

/**
 * A focused Filter Expression editor over `doc` with the Signature Hint, and
 * `extra` extensions beside it.
 */
function editor(doc: string, extra: Extension = []) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        filterExpressionLanguage,
        signatureHint({ receiverType: () => "string" }),
        extra,
      ],
    }),
  });
  // happy-dom reports a document without focus, which CodeMirror reads as
  // an editor without focus.
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  view.focus();
  return {
    view,
    caret(pos: number) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
    },
    hint: () => parent.querySelector<HTMLElement>(`.${SIGNATURE_HINT_CLASS}`),
    [Symbol.dispose]() {
      view.destroy();
      hasFocus.mockRestore();
      parent.remove();
    },
  };
}

it("shows the signature with the parameter at the caret marked and the description beneath", () => {
  using field = editor("title.slice(1, )");
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

it("moves the mark as the caret moves to another argument", () => {
  using field = editor("title.slice(1, 2)");
  field.caret("title.slice(".length);
  expect(field.hint()?.querySelector("mark")?.textContent).toBe(
    "start: number",
  );
  field.caret("title.slice(1, ".length);
  expect(field.hint()?.querySelector("mark")?.textContent).toBe("end?: number");
});

it("closes when the caret leaves the call", () => {
  using field = editor("title.slice(1, 2) + 1");
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
  field.caret("title.slice(1, 2) +".length);
  expect(field.hint()).toBeNull();
});

it("closes when the editor loses focus", () => {
  using field = editor("title.slice(1, 2)");
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
  field.view.contentDOM.blur();
  expect(field.hint()).toBeNull();
});

it("shows while another extension reconfigures the editor as it takes focus", () => {
  // As the host's tooltip placement does: a dispatch from the focus event.
  const placement = new Compartment();
  using field = editor(
    "title.slice(1, 2)",
    ViewPlugin.define(() => ({}), {
      eventHandlers: {
        focus(_event, view) {
          view.dispatch({ effects: placement.reconfigure([]) });
        },
      },
      provide: () => placement.of([]),
    }),
  );
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
});
