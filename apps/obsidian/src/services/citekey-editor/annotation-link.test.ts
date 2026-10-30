// @vitest-environment happy-dom
import { EditorState, Prec } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { tokenClassNodeProp, editorMode } = vi.hoisted(() => ({
  tokenClassNodeProp: {},
  /** Whether the next editor these tests open shows Live Preview. */
  editorMode: { livePreview: false },
}));

// Obsidian's Markdown mode is a stream parser of its own fork, whose tree
// carries each token's classes; the nodes here are classed as it classes them.
vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return {
    ...actual,
    tokenClassNodeProp,
    syntaxTree: (state: EditorState) => ({
      length: state.doc.length,
      iterate: ({
        from,
        to,
        enter,
      }: {
        from: number;
        to: number;
        enter: (node: object) => void;
      }) => {
        for (const node of hypermdTokens(state.doc.toString())) {
          if (node.to < from || node.from > to) continue;
          enter({
            ...node,
            type: {
              prop: (property: unknown) =>
                property === tokenClassNodeProp ? node.classes : undefined,
            },
          });
        }
      },
    }),
  };
});

const BRACKET = "formatting formatting-link link";
const PAREN = "formatting formatting-link-string string url";

/**
 * The token nodes Obsidian's HyperMD mode makes of the inline links and code
 * spans these tests write, as Obsidian 1.14.4 tokenizes them. Plain text makes
 * no node, which leaves a gap between the nodes either side, and touching
 * tokens of the same classes merge into one node, as the stream parser merges
 * them.
 */
function hypermdTokens(
  text: string,
): { from: number; to: number; classes: string }[] {
  const nodes: { from: number; to: number; classes: string }[] = [];
  let at = 0;
  const push = (to: number, classes: string): void => {
    const last = nodes.at(-1);
    if (to <= at) return;
    if (last?.to === at && last.classes === classes) last.to = to;
    else nodes.push({ from: at, to, classes });
    at = to;
  };
  while (at < text.length) {
    if (text[at] === "`") {
      const close = text.indexOf("`", at + 1);
      push(close === -1 ? text.length : close + 1, "inline-code");
      continue;
    }
    if (text[at] !== "[") {
      at++;
      continue;
    }
    // A bracket pair inside the link text is part of the text.
    let depth = 0;
    let close = -1;
    for (let index = at + 1; index < text.length && close === -1; index++) {
      if (text[index] === "[") depth++;
      else if (text[index] === "]" && depth-- === 0) close = index;
    }
    if (close === -1) {
      at++;
      continue;
    }
    push(at + 1, BRACKET);
    push(close, "link");
    push(close + 1, BRACKET);
    const end = text.indexOf(")", at);
    if (text[at] !== "(" || end === -1) continue;
    push(at + 1, PAREN);
    push(end, "string url");
    push(end + 1, PAREN);
  }
  return nodes;
}

// Obsidian's editor carries the note it edits in a state field of its own.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({ file: { path: "note.md" } }),
      update: (value) => value,
    }),
    // Obsidian's own Live Preview flag, which a new editor reads once.
    editorLivePreviewField: StateField.define({
      create: () => editorMode.livePreview,
      update: (value) => value,
    }),
  };
});

import { editorInfoField, editorLivePreviewField } from "obsidian";

import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import { presented } from "@/services/citation-text/__fixtures__";
import type { DocumentCitations } from "@/services/citation-text/present";
import type { Held } from "@/services/query-client/service";

import {
  annotationLinkAtPos,
  annotationLinkHoverExtension,
} from "./annotation-link";
import type { AnnotationLinkHoverHandlers } from "./annotation-link";

/** The handlers of an editor whose Annotation Citations show as links. */
function linkHandlers(
  shown: AnnotationHoverRequest[],
  overrides: Partial<AnnotationLinkHoverHandlers> = {},
): AnnotationLinkHoverHandlers {
  return {
    showAnnotation: (request) => shown.push(request),
    showCitations: () => false,
    citationText: () => {
      throw new Error("No citation text is read while citations are off");
    },
    openItem: () => {
      throw new Error("Nothing opens a Literature Note here");
    },
    ...overrides,
  };
}

const LINK =
  "[p. 2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)";

/** `See [p. 2](zotero://…) here.` — the link spans `[4, 76)`. */
const LINE = EditorState.create({ doc: `See ${LINK} here.` });

describe("annotationLinkAtPos", () => {
  it("answers with the annotation a position in the link text names", () => {
    expect(annotationLinkAtPos(LINE, 6)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: "2",
      groupID: null,
    });
  });

  it("answers inside the URL too, which Source mode shows", () => {
    expect(annotationLinkAtPos(LINE, 40)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("answers nothing beside the link", () => {
    expect(annotationLinkAtPos(LINE, 1)).toBeNull();
    expect(annotationLinkAtPos(LINE, 4 + LINK.length + 2)).toBeNull();
  });

  it("reads a group Library's link with its group", () => {
    const state = EditorState.create({
      doc: "[quote](zotero://open/groups/42/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 2)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: null,
      groupID: 42,
    });
  });

  it("reads link text that carries brackets of its own", () => {
    const state = EditorState.create({
      doc: "[[p. 2] quote](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 3)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("picks the link the position sits in, of two on one line", () => {
    const state = EditorState.create({
      doc:
        "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5) and " +
        "[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)",
    });
    expect(annotationLinkAtPos(state, 1)?.annotationKey).toBe("PUPR5FG5");
    expect(annotationLinkAtPos(state, 70)?.annotationKey).toBe("Q8ZR4TDH");
  });

  it("answers nothing for a Zotero link that names no annotation", () => {
    for (const doc of [
      "[item](zotero://open/library/items/RGRPDF24)",
      "[item](zotero://select/library/items/RGRPDF24)",
      "[web](https://example.org/?annotation=FDRFQ7C2)",
    ]) {
      expect(annotationLinkAtPos(EditorState.create({ doc }), 2)).toBeNull();
    }
  });

  it("answers the link that begins where the one before it ends", () => {
    const first =
      "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5)";
    const state = EditorState.create({
      doc: `${first}[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)`,
    });
    expect(annotationLinkAtPos(state, first.length - 1)?.annotationKey).toBe(
      "PUPR5FG5",
    );
    expect(annotationLinkAtPos(state, first.length)?.annotationKey).toBe(
      "Q8ZR4TDH",
    );
  });

  it("reads a link with empty text, whose brackets parse as one node", () => {
    const state = EditorState.create({
      doc: "[](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 10)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("answers nothing for what Obsidian does not parse as a link", () => {
    for (const doc of [
      `\`${LINK}\``,
      "p. 2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
      "[p. 2] (zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    ]) {
      expect(annotationLinkAtPos(EditorState.create({ doc }), 3)).toBeNull();
    }
  });
});

// What a hovered link in the editor shows is proven in the running app
// (`packages/e2e/src/annotation-links.e2e.ts`), which cannot move the pointer
// within one link.
describe("annotationLinkHoverExtension", () => {
  it("shows the annotation without a citation hover setting", () => {
    const shown: AnnotationHoverRequest[] = [];
    // The link text classed the way Obsidian's Markdown highlighter classes it.
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: `See ${LINK} here.`,
        extensions: [
          editorInfoField,
          EditorView.decorations.of(
            Decoration.set([Decoration.mark({ class: "cm-link" }).range(5, 9)]),
          ),
          annotationLinkHoverExtension(linkHandlers(shown)),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    view.dom.classList.add("is-live-preview");
    const linkText = view.dom.querySelector<HTMLElement>(".cm-link")!;

    linkText.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: linkText.firstChild,
      }),
    );
    expect(shown).toEqual([]);

    linkText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(shown).toHaveLength(1);
  });

  it("anchors on the whole link while the pointer crosses from its text to its URL", () => {
    const shown: AnnotationHoverRequest[] = [];
    // Source mode draws the text and the URL as two spans. Obsidian's token
    // highlighter sits at `Prec.lowest`, after every plugin extension, so the
    // stand-in does too.
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: `See ${LINK} here.`,
        extensions: [
          editorInfoField,
          annotationLinkHoverExtension(linkHandlers(shown)),
          Prec.lowest(
            EditorView.decorations.of(
              Decoration.set([
                Decoration.mark({ class: "cm-link" }).range(5, 9),
                Decoration.mark({ class: "cm-url" }).range(11, 75),
              ]),
            ),
          ),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    const linkText = view.dom.querySelector<HTMLElement>(".cm-link")!;
    const url = view.dom.querySelector<HTMLElement>(".cm-url")!;

    linkText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    url.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: linkText }),
    );

    expect(shown).toHaveLength(1);
    const anchor = shown[0]!.targetEl;
    expect(anchor.contains(linkText) && anchor.contains(url)).toBe(true);
    expect(anchor.textContent).toBe(LINK);
  });

  it("shows the second of two touching links when its text is hovered", () => {
    const shown: AnnotationHoverRequest[] = [];
    const first =
      "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5)";
    const second =
      "[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: first + second,
        extensions: [
          editorInfoField,
          annotationLinkHoverExtension(linkHandlers(shown)),
          Prec.lowest(
            EditorView.decorations.of(
              Decoration.set([
                Decoration.mark({ class: "cm-link" }).range(1, 2),
                Decoration.mark({ class: "cm-link" }).range(
                  first.length + 1,
                  first.length + 2,
                ),
              ]),
            ),
          ),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    const secondText = view.dom.querySelectorAll<HTMLElement>(".cm-link")[1]!;

    secondText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(shown.map(({ link }) => link.annotationKey)).toEqual(["Q8ZR4TDH"]);
    expect(shown[0]!.targetEl.textContent).toBe(second);
  });
});

/** An Annotation Citation, the empty-text form of a Durable Annotation Link. */
const CITATION_URL =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";
const CITATION = `[](${CITATION_URL})`;
/** Where {@link CITATION} starts in `See … here.` */
const CITATION_START = 4;

/** The document's citations, formatting {@link CITATION} as `(Doe 2024, 2)`. */
function citationsOf(
  formatted: Record<string, number[]> = { [CITATION]: [CITATION_START] },
): Held<DocumentCitations> {
  const value: DocumentCitations = {
    lookup: lookupAnswer({}, { ABCD2345: "doe2024" }),
    formatted: new Map(
      Object.entries(formatted).map(([source, starts]) => [
        source,
        starts.map((start) => ({
          ...presented("(Doe 2024, 2)"),
          text: {
            ...presented("(Doe 2024, 2)").text,
            citations: [{ id: "ABCD2345", mode: "normal" as const }],
          },
          start,
        })),
      ]),
    ),
    entrySerials: false,
    summaries: new Map(),
    literalWorks: new Map(),
  };
  return { value, status: "fresh", settled: Promise.resolve(value) };
}

/** A Live Preview editor over `doc`, with `handlers`. */
function livePreviewEditor(
  doc: string,
  handlers: AnnotationLinkHoverHandlers,
  { livePreview = true }: { livePreview?: boolean } = {},
): EditorView {
  editorMode.livePreview = livePreview;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        editorInfoField,
        editorLivePreviewField,
        annotationLinkHoverExtension(handlers),
      ],
    }),
  });
  if (livePreview) view.dom.classList.add("is-live-preview");
  return view;
}

/** The element showing `text`, which a widget draws in the link's place. */
function shownAs(view: EditorView, text: string): HTMLElement | undefined {
  return [...view.contentDOM.querySelectorAll<HTMLElement>("span")].find(
    (element) => element.textContent === text,
  );
}

// What a reader sees is proven in the running app
// (`packages/e2e/src/annotation-citations.e2e.ts`); these cases cover which
// links the editor shows as citations, and what their hover and click carry.
describe("Annotation Citations in Live Preview", () => {
  it("shows the formatted citation in place of the link", () => {
    const shown: AnnotationHoverRequest[] = [];
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers(shown, {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe("See (Doe 2024, 2) here.");
  });

  it("keeps the link while the setting is off", () => {
    const view = livePreviewEditor(`See ${CITATION} here.`, linkHandlers([]));
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(`See ${CITATION} here.`);
  });

  it("keeps the link in Source mode", () => {
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
      { livePreview: false },
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(`See ${CITATION} here.`);
  });

  it("keeps a link with text, and one the citations leave out, as links", () => {
    const labelled = `[p. 2](${CITATION_URL})`;
    const view = livePreviewEditor(
      `See ${labelled} and ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        // No text for the empty link: the Document Citation Set leaves it
        // out, as it does an Annotation Zotero no longer has.
        citationText: () => citationsOf({ [labelled]: [4] }),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(
      `See ${labelled} and ${CITATION} here.`,
    );
  });

  it("gives the hover the Annotation's Item, and opens that Item's note", () => {
    const shown: AnnotationHoverRequest[] = [];
    const opened: unknown[] = [];
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers(shown, {
        showCitations: () => true,
        citationText: () => citationsOf(),
        openItem: (indexedKey, pane) => opened.push([indexedKey, pane]),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    shownAs(view, "(Doe 2024, 2)")!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(shown).toHaveLength(1);
    expect(shown[0]!.link.annotationKey).toBe("FDRFQ7C2");
    expect(shown[0]!.reference).toMatchObject({
      work: { citekey: "doe2024", indexedKey: "ABCD2345" },
      shown: {
        citation: { source: CITATION },
        at: { kind: "offset", start: CITATION_START },
      },
    });
    shown[0]!.reference!.open("tab");
    expect(opened).toEqual([["ABCD2345", "tab"]]);
  });

  it("follows the link on a click, as the link itself does", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    using _restore = { [Symbol.dispose]: () => open.mockRestore() };
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    shownAs(view, "(Doe 2024, 2)")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(open).toHaveBeenCalledWith(CITATION_URL, undefined);
  });
});
