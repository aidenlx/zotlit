import { describe, expect, it } from "vitest";

import { alignPageLabel } from "@/page-label";

/** A six-page front-matter run: roman covers i-iv, then arabic restarts. */
const LABELS = ["i", "ii", "iii", "iv", "1", "2"];

describe("the Page Label a creation gets", () => {
  it("takes the extracted label when the Attachment has no Annotation", () => {
    expect(alignPageLabel(LABELS, 4, [])).toBe("1");
  });

  it("falls back to the page number when nothing was extracted", () => {
    expect(alignPageLabel([], 4, [])).toBe("5");
  });

  it("follows the newest Annotation that disagrees with the extraction", () => {
    // Page 5 extracted as "2"; the user labelled page 4 as "233", so the run
    // the user sees continues to 234.
    expect(
      alignPageLabel(LABELS, 5, [{ pageLabel: "233", pageIndex: 4 }]),
    ).toBe("234");
  });

  it("accepts a page range as the previous label", () => {
    expect(
      alignPageLabel(LABELS, 5, [{ pageLabel: "233-234", pageIndex: 4 }]),
    ).toBe("234");
  });

  it("stops at the newest usable Annotation, even when it does not win", () => {
    // The newest is on a page the extraction numbers in roman, so the deltas
    // disagree and the walk stops there rather than reaching the arabic one.
    expect(
      alignPageLabel(LABELS, 5, [
        { pageLabel: "233", pageIndex: 4 },
        { pageLabel: "iv", pageIndex: 3 },
      ]),
    ).toBe("2");
  });

  it("ignores a read-only Annotation and one labelled `-`", () => {
    expect(
      alignPageLabel(LABELS, 5, [
        { pageLabel: "233", pageIndex: 4 },
        { pageLabel: "-", pageIndex: 4 },
        { pageLabel: "999", pageIndex: 4, readOnly: true },
      ]),
    ).toBe("234");
  });

  it("ignores an Annotation on a later page", () => {
    expect(
      alignPageLabel(LABELS, 4, [
        { pageLabel: "233", pageIndex: 3 },
        { pageLabel: "500", pageIndex: 5 },
      ]),
    ).toBe("1");
  });

  it("reads a zero-padded label as its own integer, as Zotero does", () => {
    expect(alignPageLabel(LABELS, 5, [{ pageLabel: "07", pageIndex: 4 }])).toBe(
      "8",
    );
  });
});
