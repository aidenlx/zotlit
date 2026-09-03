// Stateless auto-pairing for Eta `<% %>` tags: open-insert, prefix reflow,
// type-over, and pair-delete — all driven by document context, no pair state.

import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { regex } from "arkregex";

const PREFIX = /^[=~]$/;
const MARKER = /^[-_]$/;

// oxlint-disable-next-line max-params -- CM's inputHandler callback signature.
const insertTag = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || text.length !== 1) return false;
  const { state } = view;

  // Type `%` right after `<` -> `<% ‸ %>` (padded, cursor between).
  if (text === "%" && state.sliceDoc(from - 1, from) === "<") {
    view.dispatch({
      changes: { from, to, insert: "%  %>" },
      selection: EditorSelection.cursor(from + 2),
      userEvent: "input.type",
    });
    return true;
  }

  // Reflow: a prefix/marker typed into a fresh empty pair `<%‹m› ‸ %>`
  // rewrites to `<%‹m›‹prefix› ‸ %>` — tight against the open, one padding space.
  if (PREFIX.test(text) || MARKER.test(text)) {
    const left = regex("<%(?<marker>[-_]?) $").exec(
      state.sliceDoc(Math.max(0, from - 4), from),
    );
    const rightOk = state.sliceDoc(to, to + 3).startsWith(" %>");
    if (left && rightOk) {
      const marker = left.groups.marker;
      const isPrefix = PREFIX.test(text);
      // A marker only reflows when none exists yet; a prefix always reflows.
      if (isPrefix || marker === "") {
        const open = isPrefix ? `<%${marker}${text} ` : `<%${text} `;
        const start = from - left[0].length;
        view.dispatch({
          changes: { from: start, to: from, insert: open },
          selection: EditorSelection.cursor(start + open.length),
          userEvent: "input.type",
        });
        return true;
      }
    }
  }

  // Type-over the close delimiter: `%` before `%>`, or `>` after `%`.
  if (text === "%" && state.sliceDoc(from, from + 2) === "%>") {
    view.dispatch({ selection: EditorSelection.cursor(from + 1) });
    return true;
  }
  if (text === ">" && state.sliceDoc(from - 1, from + 1) === "%>") {
    view.dispatch({ selection: EditorSelection.cursor(from + 1) });
    return true;
  }

  return false;
});

const deletePair = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const range = view.state.selection.main;
      if (!range.empty) return false;
      const { from } = range;
      const left = /<%[-_]?[=~]? $/.exec(
        view.state.sliceDoc(Math.max(0, from - 5), from),
      );
      if (!left || !view.state.sliceDoc(from, from + 3).startsWith(" %>")) {
        return false;
      }
      const start = from - left[0].length;
      view.dispatch({
        changes: { from: start, to: from + 3, insert: "" },
        selection: EditorSelection.cursor(start),
        userEvent: "delete.backward",
      });
      return true;
    },
  },
]);

export function etaAutoPair(): Extension {
  // Highest precedence so our inputHandler/keymap win over basicSetup's closeBrackets.
  return Prec.highest([insertTag, deletePair]);
}
