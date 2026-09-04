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

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({ file: { path: "note.md" } }),
      update: (value) => value,
    }),
  };
});

import { editorInfoField } from "obsidian";

import type { Held } from "@/lib/held-reads";
import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import { citationKey } from "@/services/citation-text/present";
import type { DocumentCitations } from "@/services/citation-text/present";
import { hoverPreferences } from "@/services/citekey-navigation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { defaults } from "@/services/settings/schema";

import { wikilinkEditorExtension } from "./extension";

const LITERATURE_NOTE = {
  path: "literatures/example.md",
  indexedKey: "1/EXAMPLE",
  citationKey: "example",
};

function viewOf(
  doc: string,
  {
    enabled = true,
    formatted = true,
    content = rendered("(Example 2020, p. 7)"),
  }: {
    enabled?: boolean;
    formatted?: boolean;
    /** The formatted citation the shared text holds for the document. */
    content?: RenderedCitation;
  } = {},
) {
  // Held once, the way the service holds one document's answer: every ask
  // gets the same value, which is what lets a widget compare by reference.
  const value: DocumentCitations = {
    entrySerials: false,
    formatted: new Map([
      [
        citationKey({
          source: "[@example, {p. 7}]",
          works: [LITERATURE_NOTE.indexedKey],
        }),
        occurrences(content),
      ],
    ]),
    summaries: new Map([[LITERATURE_NOTE.indexedKey, "Example (2020)"]]),
    literalWorks: new Map(),
  };
  const held: Held<DocumentCitations> = {
    value,
    status: "fresh",
    settled: Promise.resolve(value),
  };
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        editorInfoField,
        wikilinkEditorExtension({
          literatureNote: (linkpath) =>
            linkpath === "literatures/example" ? LITERATURE_NOTE : null,
          enabled: () => enabled,
          citationText: () => (formatted ? held : null),
          open: () => undefined,
          showPopover: () => undefined,
          hoverPreferences: () => hoverPreferences(defaults),
          // Hover and click are this surface's own suite; here the Citation is
          // only drawn.
          popoverHover: () => false,
          clickIntercepted: () => false,
        }),
      ],
    }),
  });
  return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
}

describe("wikilinkEditorExtension theme hooks", () => {
  it("keeps Source mode Literature Note links outside the hook", () => {
    livePreview.mockReturnValue(false);
    using view = viewOf("[[literatures/example|Example]]");

    expect(view.dom.querySelector(".zt-literature-note-link")).toBeNull();
  });

  it("adds the literal combined hooks to a rendered Literature Note Citation", () => {
    livePreview.mockReturnValue(true);
    using view = viewOf("[[literatures/example#cite:locator=7]]");

    const citation = view.dom.querySelector(".zt-citation");
    expect(citation?.classList.contains("zt-literature-note-link")).toBe(true);
  });

  it("leaves native, excluded, and unresolved links outside the hook", () => {
    livePreview.mockReturnValue(true);
    for (const [doc, options] of [
      ["[[literatures/example#cite:locator=7]]", { enabled: false }],
      ["[[literatures/example#cite:locator=7]]", { formatted: false }],
      ["[[literatures/example|Example]]", {}],
      ["[[literatures/example#Heading]]", {}],
      ["[[literatures/example#^block-id]]", {}],
      ["![[literatures/example]]", {}],
      ["[[notes/missing]]", {}],
    ] as const) {
      using view = viewOf(doc, options);

      expect(view.dom.querySelector(".zt-literature-note-link")).toBeNull();
    }
  });
});

describe("wikilinkEditorExtension citation rendering", () => {
  it("shows a link the style wrote as text, since the widget is the link", () => {
    livePreview.mockReturnValue(true);
    using view = viewOf("[[literatures/example#cite:locator=7]]", {
      content: {
        content: [
          {
            t: "Link",
            c: [
              ["", [], []],
              [{ t: "Str", c: "doi.org/10.1/x" }],
              ["https://doi.org/10.1/x", ""],
            ],
          },
        ],
        citations: [],
      },
    });

    const citation = view.dom.querySelector(".zt-citation");
    expect(citation?.querySelector("a")).toBeNull();
    expect(citation?.textContent).toBe("doi.org/10.1/x");
  });

  it("keeps the drawn citation while an edit lands away from it", () => {
    livePreview.mockReturnValue(true);
    using view = viewOf("[[literatures/example#cite:locator=7]] tail");
    const drawn = view.dom.querySelector(".zt-citation");
    expect(drawn?.textContent).toBe("(Example 2020, p. 7)");

    view.dispatch({
      changes: { from: view.state.doc.length, insert: " more" },
    });

    // The held text is unchanged, so CodeMirror keeps the element it already
    // drew.
    expect(view.dom.querySelector(".zt-citation")).toBe(drawn);
  });
});
