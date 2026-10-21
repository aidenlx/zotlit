// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

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
});

// What a hovered link in the editor shows is proven in the running app
// (`packages/e2e/src/annotation-links.e2e.ts`), which cannot move the pointer
// within one link.
describe("annotationLinkHoverExtension", () => {
  it("hovers once while the pointer moves inside one link", () => {
    const shown: AnnotationHoverRequest[] = [];
    // The link text classed the way Obsidian's Markdown highlighter classes
    // it; happy-dom lays nothing out, so the pointer is answered from inside it.
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
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);
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
});
