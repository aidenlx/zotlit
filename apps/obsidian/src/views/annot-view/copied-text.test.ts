import { describe, expect, it } from "vitest";

import { copiedText } from "./copied-text";

describe("the copied text", () => {
  it("takes each card's quoted text, or its comment, in list order", () => {
    expect(
      copiedText([
        // A highlight: its quoted text, and not its comment.
        { text: "The river floods each spring.", comment: "Check <b>1998</b>" },
        // A note: its comment, which Zotero formats with tags.
        { text: null, comment: "Compare with <i>Rougier</i>, ch. 2" },
        // An image: its comment too.
        { text: null, comment: "Figure 3, flood map" },
      ]),
    ).toBe(
      "The river floods each spring.\n\nCompare with Rougier, ch. 2\n\nFigure 3, flood map",
    );
  });

  it("leaves out a card with neither text nor comment", () => {
    expect(
      copiedText([
        { text: null, comment: null },
        { text: "Levees raise the water line.", comment: null },
      ]),
    ).toBe("Levees raise the water line.");
  });
});
