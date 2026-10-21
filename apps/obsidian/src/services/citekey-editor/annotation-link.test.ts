import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { annotationLinkAtPos } from "./annotation-link";

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
