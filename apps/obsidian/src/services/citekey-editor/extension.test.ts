// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { citekeyAtPos, citekeyEditorExtension } from "./extension";

const stateOf = (doc: string): EditorState => EditorState.create({ doc });

function editorView(options: ConstructorParameters<typeof EditorView>[0]) {
  const view = new EditorView(options);
  return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
}

/** `See @doe2024 here.` — the key spans `[4, 12)`. */
const LINE = stateOf("See @doe2024 here.");

describe("citekeyAtPos", () => {
  it("answers with the key the position sits inside", () => {
    expect(citekeyAtPos(LINE, 8)).toBe("doe2024");
  });

  it("counts either boundary as inside, as Obsidian's token lookup does", () => {
    expect(citekeyAtPos(LINE, 4)).toBe("doe2024");
    expect(citekeyAtPos(LINE, 12)).toBe("doe2024");
  });

  it("answers with nothing past either boundary", () => {
    expect(citekeyAtPos(LINE, 3)).toBeNull();
    expect(citekeyAtPos(LINE, 13)).toBeNull();
  });

  it("reads the line the position falls on", () => {
    const doc = stateOf("@first\n@second");
    expect(citekeyAtPos(doc, 2)).toBe("first");
    expect(citekeyAtPos(doc, 9)).toBe("second");
  });

  it("answers with nothing on plain text", () => {
    expect(citekeyAtPos(stateOf("plain text only"), 3)).toBeNull();
  });
});

describe("citekeyEditorExtension theme hooks", () => {
  it("adds literal resolved and unresolved citation-key hooks in Source mode", () => {
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "@resolved and @unresolved",
        extensions: citekeyEditorExtension({
          open: () => undefined,
          hoverNotePath: () => null,
          resolves: (citekey) => citekey === "resolved",
          citationText: () => null,
          requestCitationText: () => undefined,
        }),
      }),
    });

    expect(view.dom.querySelector(".zt-citation-key")?.textContent).toBe(
      "@resolved",
    );
    expect(
      view.dom.querySelectorAll(".zt-citation-key-unresolved").item(0)
        .textContent,
    ).toBe("@unresolved");
  });
});
