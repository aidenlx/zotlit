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

import { templateCompletion } from "./completion";
import { fieldPopupKeyHost } from "./field-popup";
import type { FieldPopupKeys } from "./field-popup";
import { filterExpressionLanguage } from "./filter-expression";
import { filterExpressionCompletion } from "./filter-expression-completion";
import type { ExpressionVocabulary } from "./filter-expression-completion";
import { signatureHint } from "./signature-hint-tooltip";
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

const COMPLETIONS = {
  "Template Completion": {
    doc: "{{ zt.ti",
    extension: templateCompletion(() => ({ root: "note", partials: [] })),
    accepted: "{{ zt.title",
  },
  "Expression Completion": {
    doc: "titl",
    extension: [
      filterExpressionLanguage,
      filterExpressionCompletion(() => VOCABULARY),
    ],
    accepted: "title",
  },
};

describe.each(Object.entries(COMPLETIONS))(
  "%s",
  (_, { doc, extension, accepted }) => {
    it.each(["Tab", "Enter"])(
      "takes the selected option on %s",
      async (key) => {
        using field = editor(doc, extension);
        await field.open();
        expect(field.press(key)).toBe(true);
        expect(field.text().startsWith(accepted)).toBe(true);
        expect(field.listOpen()).toBe(false);
      },
    );

    it("closes the list on Escape and takes the key", async () => {
      using field = editor(doc, extension);
      await field.open();
      expect(field.press("Escape")).toBe(true);
      expect(field.listOpen()).toBe(false);
      expect(field.text()).toBe(doc);
      // With the list closed, Escape is the host's.
      expect(field.press("Escape")).toBe(false);
    });

    it("leaves Shift-Tab to move focus while the list stands", async () => {
      using field = editor(doc, extension);
      await field.open();
      expect(field.press("Tab", { shiftKey: true })).toBe(false);
      expect(field.text()).toBe(doc);
    });

    it("leaves Tab and Enter alone while no list stands", () => {
      using field = editor(doc, extension);
      expect(completionStatus(field.view.state)).toBeNull();
      expect(field.press("Tab")).toBe(false);
      expect(field.text()).toBe(doc);
    });

    it("takes no key while an IME composition runs", async () => {
      using field = editor(doc, extension);
      await field.open();
      field.view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      expect(field.view.compositionStarted).toBe(true);
      expect(field.press("Tab")).toBe(false);
      expect(field.press("Escape")).toBe(false);
      expect(field.text()).toBe(doc);
    });
  },
);

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
      /** The keys of the one hold standing. */
      current() {
        const standing = holds.filter((hold) => !hold.released);
        expect(standing).toHaveLength(1);
        return standing[0]!.keys;
      },
    };
  }

  it("holds the keys while the list stands, and accept takes the option", async () => {
    const host = fakeHost();
    using field = editor("titl", [
      COMPLETIONS["Expression Completion"].extension,
      host.extension,
    ]);
    expect(host.holds).toHaveLength(0);
    await field.open();
    expect(host.current().accept()).toBe(true);
    expect(field.text()).toBe("title");
    expect(host.holds.every((hold) => hold.released)).toBe(true);
  });

  it("closes the list, then the Signature Hint, then lets go", async () => {
    const host = fakeHost();
    using field = editor("title.slice(", [
      COMPLETIONS["Expression Completion"].extension,
      signatureHint(),
      host.extension,
    ]);
    // The hint stands at the caret, so the keys are held once the field
    // has focus, before any list.
    const keys = await vi.waitFor(() => host.current());
    await field.open();
    expect(host.current()).toBe(keys);
    expect(keys.close()).toBe(true);
    expect(field.listOpen()).toBe(false);
    // The hint has nothing to take.
    expect(keys.accept()).toBe(false);
    expect(keys.close()).toBe(true);
    expect(host.holds.every((hold) => hold.released)).toBe(true);
    expect(keys.close()).toBe(false);
  });

  it("lets go when the editor goes", async () => {
    const host = fakeHost();
    const field = editor("titl", [
      COMPLETIONS["Expression Completion"].extension,
      host.extension,
    ]);
    await field.open();
    expect(host.holds).toHaveLength(1);
    field[Symbol.dispose]();
    expect(host.holds[0]!.released).toBe(true);
  });
});
