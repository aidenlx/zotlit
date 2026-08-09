// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { livePreview, tokenClassNodeProp } = vi.hoisted(() => ({
  livePreview: vi.fn(() => false),
  tokenClassNodeProp: {},
}));

vi.mock("@/lib/editor-decoration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/editor-decoration")>()),
  livePreviewOf: livePreview,
}));

vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return {
    ...actual,
    tokenClassNodeProp,
    syntaxTree: (state: EditorState) => ({
      length: state.doc.length,
      iterate: ({ enter }: { enter: (node: object) => void }) => {
        const text = state.doc.toString();
        const opening = text.indexOf("[[");
        const closing = text.lastIndexOf("]]");
        if (opening === -1 || closing === -1) return;
        const embedded = opening > 0 && text.charAt(opening - 1) === "!";
        const nodes = [
          {
            from: opening,
            to: opening + 2,
            classes: [
              "formatting-link-start",
              ...(embedded ? ["formatting-embed"] : []),
            ],
          },
          {
            from: opening + 2,
            to: closing,
            classes: ["hmd-internal-link"],
          },
          {
            from: closing,
            to: closing + 2,
            classes: ["formatting-link-end"],
          },
        ];
        for (const node of nodes) {
          enter({
            ...node,
            type: {
              prop: (property: unknown) =>
                property === tokenClassNodeProp
                  ? node.classes.join(" ")
                  : undefined,
            },
          });
        }
      },
    }),
  };
});

import { wikilinkEditorExtension } from "./extension";

const LITERATURE_NOTE = {
  path: "literatures/example.md",
  indexedKey: "1/EXAMPLE",
  citationKey: "example",
};

function viewOf(doc: string) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: wikilinkEditorExtension({
        literatureNote: (linkpath) =>
          linkpath === "literatures/example" ? LITERATURE_NOTE : null,
        enabled: () => true,
        fragmentlessDisplay: () => true,
        citationText: () => null,
        requestCitationText: () => undefined,
      }),
    }),
  });
  return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
}

describe("wikilinkEditorExtension theme hooks", () => {
  it("marks a resolved Literature Note link without its source brackets", () => {
    livePreview.mockReturnValue(false);
    using view = viewOf("[[literatures/example|Example]]");

    const link = view.dom.querySelector(".zt-literature-note-link");
    expect(link?.textContent).toBe("literatures/example|Example");
  });

  it("adds the literal combined hooks to a rendered Literature Note Citation", () => {
    livePreview.mockReturnValue(true);
    using view = viewOf("[[literatures/example#cite:locator=7]]");

    const citation = view.dom.querySelector(".zt-citation");
    expect(citation?.classList.contains("zt-literature-note-link")).toBe(true);
  });

  it("leaves embeds and unresolved links outside the hook", () => {
    livePreview.mockReturnValue(false);
    for (const doc of ["![[literatures/example]]", "[[notes/missing]]"]) {
      using view = viewOf(doc);

      expect(view.dom.querySelector(".zt-literature-note-link")).toBeNull();
    }
  });
});
