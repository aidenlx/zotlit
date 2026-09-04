// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { livePreview, parseState, tokenClassNodeProp, lineClassNodeProp } =
  vi.hoisted(() => ({
    livePreview: vi.fn(() => true),
    parseState: { behind: false, footnote: true },
    tokenClassNodeProp: {},
    lineClassNodeProp: {},
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
    lineClassNodeProp,
    syntaxTree: (state: EditorState) => ({
      length: parseState.behind ? 0 : state.doc.length,
      iterate: ({ enter }: { enter: (node: object) => void }) => {
        if (parseState.behind || !parseState.footnote) return;
        enter({
          from: 6,
          to: 16,
          type: {
            prop: (property: unknown) =>
              property === tokenClassNodeProp ? "footref" : undefined,
          },
        });
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
import { rendered } from "@/services/citation-text/__fixtures__";
import type { DocumentCitations } from "@/services/citation-text/present";
import { hoverPreferences } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";

import { citekeyEditorExtension } from "./extension";

beforeEach(() => {
  parseState.behind = false;
  parseState.footnote = true;
});

afterEach(() => vi.restoreAllMocks());

it.each([
  {
    condition: "the parse is behind the viewport",
    prepare: (_view: EditorView) => {
      parseState.behind = true;
    },
  },
  {
    condition: "an IME composition is active",
    prepare: (view: EditorView) => {
      parseState.footnote = false;
      vi.spyOn(view, "composing", "get").mockReturnValue(true);
    },
  },
])("keeps a citation's footnote treatment while $condition", ({ prepare }) => {
  const doc = "[^1]: [@doe2024] tail";
  const citations: DocumentCitations = {
    formatted: new Map([
      ["[@doe2024]", [{ start: 6, text: rendered("Doe (2024)"), serials: [] }]],
    ]),
    entrySerials: false,
    summaries: new Map([["DOE22345", "Doe (2024)"]]),
    literalWorks: new Map([["doe2024", "DOE22345"]]),
  };
  const held: Held<DocumentCitations> = {
    value: citations,
    status: "fresh",
    settled: Promise.resolve(citations),
  };
  using view = Object.assign(
    new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: () => undefined,
            showPopover: () => undefined,
            hoverPreferences: () => hoverPreferences(defaults),
            hoverNotePath: () => null,
            resolveCitekey: () => ({
              kind: "missing" as const,
            }),
            navigationEnabled: () => true,
            showFormatted: () => true,
            citationText: () => held,
          }),
        ],
      }),
    }),
    { [Symbol.dispose]: () => view.destroy() },
  );
  const drawn = view.dom.querySelector(".zt-citation");
  expect(drawn?.classList.contains("cm-footref")).toBe(true);

  prepare(view);
  view.dispatch({
    changes: { from: 0, insert: "x" },
  });

  expect(view.dom.querySelector(".zt-citation")).toBe(drawn);
  expect(drawn?.classList.contains("cm-footref")).toBe(true);
});
