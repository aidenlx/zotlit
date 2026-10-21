// @vitest-environment happy-dom
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { expect, it } from "vitest";

import { filterExpressionLanguage } from "./filter-expression";
import { SIGNATURE_HINT_CLASS, signatureHint } from "./signature-hint-tooltip";
import { documentFocus } from "./test-utils";

/**
 * A focused Filter Expression editor with the Signature Hint.
 * @param doc The editor's text.
 * @param extra Extensions beside the hint.
 */
function editor(doc: string, extra: Extension = []) {
  const parent = document.body.appendChild(document.createElement("div"));
  // CodeMirror tells the editor of a focus change in a later task; each
  // change settles the wait made before it.
  let focusChanged = Promise.withResolvers<void>();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        filterExpressionLanguage,
        signatureHint({ receiver: () => ({ type: "string" }) }),
        EditorView.updateListener.of((update) => {
          if (!update.focusChanged) return;
          focusChanged.resolve();
          focusChanged = Promise.withResolvers();
        }),
        extra,
      ],
    }),
  });
  const focus = documentFocus();
  view.focus();
  return {
    view,
    caret(pos: number) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
    },
    async blur() {
      const told = focusChanged.promise;
      view.contentDOM.blur();
      await told;
    },
    /** The hint, while it shows. */
    hint: () => {
      const hint = parent.querySelector<HTMLElement>(
        `.${SIGNATURE_HINT_CLASS}`,
      );
      return hint && !hint.hidden ? hint : null;
    },
    [Symbol.dispose]() {
      view.destroy();
      focus[Symbol.dispose]();
      parent.remove();
    },
  };
}

it("closes on Escape before the host hears it", () => {
  using field = editor("title.slice(1, 2)");
  field.caret("title.slice(".length);
  const escape = () => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    field.view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(field.hint()).not.toBeNull();

  expect(escape()).toBe(true);
  expect(field.hint()).toBeNull();
  // With the hint closed, Escape is the host's.
  expect(escape()).toBe(false);

  field.caret("title.slice(1, ".length);
  expect(field.hint()).not.toBeNull();
});

it("hides when the editor loses focus", async () => {
  using field = editor("title.slice(1, 2)");
  field.caret("title.slice(1".length);
  expect(field.hint()).not.toBeNull();
  await field.blur();
  expect(field.hint()).toBeNull();
});

// Regression (#1637): the hint once read focus from the update that told of
// it, so a dispatch from the focus event, before CodeMirror tells of the
// focus, kept it hidden.
it("shows while another extension reconfigures the editor as it takes focus", () => {
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
