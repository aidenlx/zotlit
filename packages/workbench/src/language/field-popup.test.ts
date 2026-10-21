// @vitest-environment happy-dom
import {
  completionStatus,
  selectedCompletionIndex,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fieldPopupKeyHost } from "./field-popup";
import type { FieldPopupKeys } from "./field-popup";
import { filterExpressionLanguage } from "./filter-expression";
import { filterExpressionCompletion } from "./filter-expression-completion";
import type { ExpressionVocabulary } from "./filter-expression-completion";
import { documentFocus } from "./test-utils";

const VOCABULARY: ExpressionVocabulary = {
  fields: [{ path: "title", label: "Title", type: "string" }],
  context: [],
  formulas: [],
};

afterEach(() => document.body.replaceChildren());

/**
 * A focused editor holding `doc` with the caret at its end, over `extension`.
 * @returns The view, the keys pressed into it and the list it shows.
 */
function editor(doc: string, extension: Extension) {
  const focus = documentFocus();
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: extension,
    }),
  });
  view.focus();
  return {
    view,
    text: () => view.state.doc.toString(),
    listOpen: () => selectedCompletionIndex(view.state) !== null,
    /** Opens the list and waits until it takes keys. */
    async open() {
      startCompletion(view);
      await vi.waitFor(() => {
        if (selectedCompletionIndex(view.state) === null)
          throw new Error("no list yet");
      });
      // CodeMirror ignores an accept key in the list's first moments.
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
    /** Presses `key` into the editor, reporting whether the editor took it. */
    press(key: string, init: KeyboardEventInit = {}) {
      const event = new KeyboardEvent("keydown", {
        key,
        cancelable: true,
        bubbles: true,
        ...init,
      });
      view.contentDOM.dispatchEvent(event);
      return event.defaultPrevented;
    },
    [Symbol.dispose]() {
      view.destroy();
      focus[Symbol.dispose]();
    },
  };
}

// Template Completion opens through the same `syntaxCompletion`, so one
// language proves the keys of both.
const DOC = "titl";
const COMPLETION = [
  filterExpressionLanguage,
  filterExpressionCompletion(() => VOCABULARY),
];
const ACCEPTED = "title";

describe("Expression Completion", () => {
  it.each(["Tab", "Enter"])("takes the selected option on %s", async (key) => {
    using field = editor(DOC, COMPLETION);
    await field.open();
    expect(field.press(key)).toBe(true);
    expect(field.text().startsWith(ACCEPTED)).toBe(true);
    expect(field.listOpen()).toBe(false);
  });

  it("closes the list on Escape and takes the key", async () => {
    using field = editor(DOC, COMPLETION);
    await field.open();
    expect(field.press("Escape")).toBe(true);
    expect(field.listOpen()).toBe(false);
    expect(field.text()).toBe(DOC);
    // With the list closed, Escape is the host's.
    expect(field.press("Escape")).toBe(false);
  });

  it("leaves Shift-Tab to move focus while the list stands", async () => {
    using field = editor(DOC, COMPLETION);
    await field.open();
    expect(field.press("Tab", { shiftKey: true })).toBe(false);
    expect(field.text()).toBe(DOC);
  });

  it("leaves Tab and Enter alone while no list stands", () => {
    using field = editor(DOC, COMPLETION);
    expect(completionStatus(field.view.state)).toBeNull();
    expect(field.press("Tab")).toBe(false);
    expect(field.text()).toBe(DOC);
  });

  it("takes no key while an IME composition runs", async () => {
    using field = editor(DOC, COMPLETION);
    await field.open();
    field.view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(field.view.compositionStarted).toBe(true);
    expect(field.press("Tab")).toBe(false);
    expect(field.press("Escape")).toBe(false);
    expect(field.text()).toBe(DOC);
  });
});

describe("a host that owns the keys", () => {
  /** A host adapter that records each hold and hands back its keys. */
  function fakeHost() {
    const holds: { keys: FieldPopupKeys; released: boolean }[] = [];
    return {
      holds,
      extension: fieldPopupKeyHost.of((keys) => {
        const hold = { keys, released: false };
        holds.push(hold);
        return () => {
          hold.released = true;
        };
      }),
      /** The holds standing. */
      standing: () => holds.filter((hold) => !hold.released),
    };
  }

  it("lets go when the editor goes", async () => {
    const host = fakeHost();
    const field = editor(DOC, [COMPLETION, host.extension]);
    await field.open();
    expect(host.holds).toHaveLength(1);
    field[Symbol.dispose]();
    expect(host.holds[0]!.released).toBe(true);
  });

  // The host gives the keys back on its own as the editor moves to another
  // window; the list still stands when the field takes focus there.
  it("hands the keys over again as the field takes focus, after the host let go of them on its own", async () => {
    const host = fakeHost();
    using field = editor(DOC, [COMPLETION, host.extension]);
    await field.open();
    const [first] = host.standing();
    first!.released = true;
    first!.keys.released();
    expect(host.standing()).toHaveLength(0);

    field.view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    const [again] = host.standing();
    expect(again?.keys).not.toBe(first!.keys);
    expect(again!.keys.accept()).toBe(true);
    expect(field.text()).toBe(ACCEPTED);
  });
});
