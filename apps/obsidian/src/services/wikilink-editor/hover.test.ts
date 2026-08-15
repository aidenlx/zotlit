// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { livePreview, tokenClassNodeProp } = vi.hoisted(() => ({
  livePreview: vi.fn(() => true),
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
        const nodes = [];
        for (let at = text.indexOf("[["); at !== -1; ) {
          const closing = text.indexOf("]]", at);
          if (closing === -1) break;
          nodes.push(
            { from: at, to: at + 2, classes: ["formatting-link-start"] },
            { from: at + 2, to: closing, classes: ["hmd-internal-link"] },
            {
              from: closing,
              to: closing + 2,
              classes: ["formatting-link-end"],
            },
          );
          at = text.indexOf("[[", closing);
        }
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
      create: () => ({
        file: { path: "note.md" },
        app: { workspace: { trigger: () => undefined } },
      }),
      update: (value: unknown) => value,
    }),
  };
});

import { Keymap, editorInfoField } from "obsidian";

import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import { citationKey } from "@/services/citation-text/present";
import type { DocumentCitations } from "@/services/citation-text/present";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import { hoverPreferences } from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { wikilinkEditorExtension } from "./extension";

const LITERATURE_NOTE = {
  path: "literatures/example.md",
  indexedKey: "1/EXAMPLE",
  citationKey: "example",
};

const OTHER_NOTE = {
  path: "literatures/other.md",
  indexedKey: "1/OTHER",
  citationKey: "other",
};

/** One Citation the hovered document holds formatted text for. */
function heldText(source: string, works: string[], text: string) {
  return [citationKey({ source, works }), occurrences(rendered(text))] as const;
}

function harness(doc: string, overrides: Partial<Settings> = {}) {
  const requests: CitationHoverRequest[] = [];
  /** Every hover Obsidian's own delegated listener would have answered. */
  const native: MouseEvent[] = [];
  let hover: HoverPreferences = hoverPreferences({ ...defaults, ...overrides });
  // Rebuilt on demand, so a fresh value redraws the widget the way a fresh
  // read of the document does.
  let held = citations();

  function citations(): DocumentCitations {
    return {
      entrySerials: false,
      formatted: new Map([
        heldText(
          "[@example, p. 7]",
          [LITERATURE_NOTE.indexedKey],
          "(Example 2020, p. 7)",
        ),
        heldText(
          "[@example, p. 7; @other]",
          [LITERATURE_NOTE.indexedKey, OTHER_NOTE.indexedKey],
          "(Example 2020, p. 7; Other 2021)",
        ),
      ]),
      summaries: new Map(),
      literalWorks: new Map(),
    };
  }

  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        editorInfoField,
        wikilinkEditorExtension({
          literatureNote: (linkpath) =>
            linkpath === "literatures/example"
              ? LITERATURE_NOTE
              : linkpath === "literatures/other"
                ? OTHER_NOTE
                : null,
          enabled: () => true,
          citationText: () => held,
          requestCitationText: () => undefined,
          open: () => undefined,
          showPopover: (request) => requests.push(request),
          hoverPreferences: () => hover,
          popoverHover: () => hover.action === "popover",
        }),
      ],
    }),
  });
  // The delegated `mouseover` Obsidian hangs on the editor element, which a
  // hover the popover answers never reaches.
  view.dom.addEventListener("mouseover", (event) => native.push(event));

  return {
    requests,
    native,
    citation: () => view.dom.querySelector<HTMLElement>(".zt-citation"),
    /** Hovers the rendered Citation, as the pointer entering it does. */
    hover: () => {
      view.dom
        .querySelector(".zt-citation")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    },
    /** Answers hover the way the named Hover Action does, from now on. */
    setHover: (next: Partial<Settings>) => {
      hover = hoverPreferences({ ...defaults, ...next });
      view.dispatch({});
    },
    /** Draws the Citation again from a fresh read, as CodeMirror does. */
    redraw: () => {
      held = citations();
      view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
    },
    [Symbol.dispose]: () => view.destroy(),
  };
}

describe("wikilinkEditorExtension hover under the Citation Popover", () => {
  it("shows the popover of the work the Citation names", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.requests[0]).toMatchObject({
      targetEl: editor.citation(),
      sourcePath: "note.md",
      works: [{ citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey }],
    });
  });

  it("stacks every work a Citation Run names, in citation order", () => {
    using editor = harness(
      "[[literatures/example#cite:locator=7]]; [[literatures/other]]",
    );

    editor.hover();

    expect(editor.requests[0]?.works).toEqual([
      { citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey },
      { citekey: "other", indexedKey: OTHER_NOTE.indexedKey },
    ]);
  });

  it("keeps Obsidian's own hover out of a Citation the popover answers", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });

  it("hovers a Citation CodeMirror has drawn again", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");
    const drawn = editor.citation();

    editor.redraw();
    expect(editor.citation()).not.toBe(drawn);
    editor.hover();

    expect(editor.requests).toHaveLength(1);
  });

  it("holds the hover back until Mod is held where Live Preview asks for it", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });

    editor.hover();
    expect(editor.requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    editor.hover();
    expect(editor.requests).toHaveLength(1);
  });
});

describe("wikilinkEditorExtension hover under the other Hover Actions", () => {
  it("leaves the hover to Obsidian under Page preview and Off", () => {
    for (const action of ["page-preview", "off"] as const) {
      using editor = harness("[[literatures/example#cite:locator=7]]", {
        "citation.hover-action": action,
      });

      editor.hover();

      expect(editor.requests).toEqual([]);
      expect(editor.native).toHaveLength(1);
    }
  });

  it("takes its listener off as soon as hover stops being the popover's", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.setHover({ "citation.hover-action": "off" });
    editor.hover();

    expect(editor.requests).toEqual([]);
    expect(editor.native).toHaveLength(1);
  });

  it("answers a Citation again once the popover is the Hover Action", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-action": "off",
    });

    editor.setHover({ "citation.hover-action": "popover" });
    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });
});
