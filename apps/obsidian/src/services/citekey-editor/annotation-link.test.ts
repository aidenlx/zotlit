// @vitest-environment happy-dom
import { EditorState, Prec } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { tokenClassNodeProp } = vi.hoisted(() => ({ tokenClassNodeProp: {} }));

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
 * no node, which leaves a gap between the nodes either side.
 */
function hypermdTokens(
  text: string,
): { from: number; to: number; classes: string }[] {
  const nodes: { from: number; to: number; classes: string }[] = [];
  let at = 0;
  const push = (to: number, classes: string): void => {
    if (to > at) nodes.push({ from: at, to, classes });
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
  };
});

import { editorInfoField } from "obsidian";

import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import { hoverPreferences } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";

import {
  annotationLinkAtPos,
  annotationLinkHoverExtension,
} from "./annotation-link";

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
  it("hovers once while the pointer moves inside one link", () => {
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
          annotationLinkHoverExtension({
            hoverPreferences: () => hoverPreferences(defaults),
            pagePreviewRequiresMod: () => true,
            showAnnotation: (request) => shown.push(request),
          }),
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
          annotationLinkHoverExtension({
            hoverPreferences: () =>
              hoverPreferences({
                ...defaults,
                "citation.hover-require-mod-source": false,
              }),
            pagePreviewRequiresMod: () => true,
            showAnnotation: (request) => shown.push(request),
          }),
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
});
