import { expect, it } from "vitest";

import type { LocalApiAnnotation } from "@/services/zotero-local-api/service";

import { matchCreatedAnnotation, resolvesSilently } from "./reconcile";
import type { AnnotationDraft } from "./write";

const ATTACHMENT = "RGRPDF24";

/** When the create left ZotLit, and when the reconciliation ran. */
const WINDOW = {
  from: Temporal.Instant.from("2026-09-16T15:52:21Z"),
  to: Temporal.Instant.from("2026-09-16T15:52:26Z"),
};

/**
 * The Annotation one create asked Zotero for. The rectangle carries a fourth
 * decimal, as a selection out of PDF.js does: Zotero's reader rounds every
 * stored coordinate to three, so the value that comes back is never this one.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/lib/utilities.js#L686-L712
 */
const DRAFT: AnnotationDraft = {
  parentKey: "RGRPDF24",
  type: "highlight",
  color: "#FFD400",
  comment: "",
  text: "Identify Your Message",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: {
    pageIndex: 0,
    rects: [[265.833_4, 611.202_4, 374.503_4, 620.019_4]],
  },
};

/** What Zotero answers for an Annotation that create would have made. */
function stored(patch: Partial<LocalApiAnnotation> = {}): LocalApiAnnotation {
  return {
    key: "MADE2345",
    type: "highlight",
    color: "#ffd400",
    comment: "",
    text: "Identify Your Message",
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[265.833, 611.202, 374.503, 620.019]],
    },
    version: 42,
    sortIndex: "00000|002041|00170",
    parentKey: ATTACHMENT,
    pageLabel: "1",
    dateAdded: "2026-09-16T15:52:23Z",
    tags: [],
    ...patch,
  };
}

it("confirms the create when exactly one annotation carries every stable field", () => {
  const candidates = [
    stored({
      key: "OTHERAA2",
      text: "Another quote",
      dateAdded: "2020-01-01T00:00:00Z",
    }),
    stored(),
  ];

  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, { candidates, window: WINDOW }),
  ).toEqual({
    kind: "confirmed",
    annotationKey: "MADE2345",
  });
});

it("leaves the create uncertain when nothing matches", () => {
  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, {
      candidates: [],
      window: WINDOW,
    }),
  ).toEqual({ kind: "unmatched", candidates: 0 });
});

it("leaves the create uncertain when two annotations match", () => {
  const candidates = [stored({ key: "TWINAAA2" }), stored({ key: "TWINAAA3" })];

  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, { candidates, window: WINDOW }),
  ).toEqual({
    kind: "unmatched",
    candidates: 2,
  });
});

it("matches the colour whatever case each side spells it in", () => {
  // The draft names `#FFD400` and Zotero stores `#ffd400`, because the write
  // lower-cases it: a case-sensitive compare would never confirm any create.
  const candidates = [stored({ color: "#ffd400" })];

  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, { candidates, window: WINDOW }),
  ).toMatchObject({ kind: "confirmed" });
});

it("rejects an annotation whose rects are not the ones the write rounded", () => {
  const candidates = [
    stored({
      position: {
        kind: "pdf-rects",
        pageIndex: 0,
        rects: [[265.83, 611.202, 374.503, 620.019]],
      },
    }),
  ];

  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, { candidates, window: WINDOW }),
  ).toEqual({
    kind: "unmatched",
    candidates: 0,
  });
});

it("rejects an annotation of another type, parent, or text", () => {
  const off: Partial<LocalApiAnnotation>[] = [
    { type: "underline" },
    { parentKey: "OTHRPDF2" },
    { text: "Identify your message" },
  ];

  for (const patch of off) {
    expect(
      matchCreatedAnnotation(DRAFT, ATTACHMENT, {
        candidates: [stored(patch)],
        window: WINDOW,
      }),
    ).toEqual({ kind: "unmatched", candidates: 0 });
  }
});

it("takes an annotation added at either end of the window and no other", () => {
  const stamps = {
    "2026-09-16T15:52:20Z": false,
    "2026-09-16T15:52:21Z": true,
    "2026-09-16T15:52:26Z": true,
    "2026-09-16T15:52:27Z": false,
  };

  for (const [dateAdded, inside] of Object.entries(stamps)) {
    expect([
      dateAdded,
      matchCreatedAnnotation(DRAFT, ATTACHMENT, {
        candidates: [stored({ dateAdded })],
        window: WINDOW,
      }).kind,
    ]).toEqual([dateAdded, inside ? "confirmed" : "unmatched"]);
  }
});

it("rejects an annotation whose dateAdded is absent or unreadable", () => {
  for (const dateAdded of [null, "not a date"]) {
    expect(
      matchCreatedAnnotation(DRAFT, ATTACHMENT, {
        candidates: [stored({ dateAdded })],
        window: WINDOW,
      }),
    ).toEqual({ kind: "unmatched", candidates: 0 });
  }
});

it("ignores the comment, which the user may edit in Zotero meanwhile", () => {
  const candidates = [stored({ comment: "typed in Zotero after the create" })];

  expect(
    matchCreatedAnnotation(DRAFT, ATTACHMENT, { candidates, window: WINDOW }),
  ).toMatchObject({ kind: "confirmed" });
});

it("resolves a colour silently only where the two name the same swatch", () => {
  expect(resolvesSilently("color", "#FF6666", "#ff6666")).toBe(true);
  expect(resolvesSilently("color", "#ff6666", "#5fb236")).toBe(false);
  expect(resolvesSilently("color", "#ff6666", null)).toBe(false);
});

it("resolves a cleared comment silently against the comment Zotero kept none of", () => {
  expect(resolvesSilently("comment", "", null)).toBe(true);
  expect(resolvesSilently("comment", "same words", "same words")).toBe(true);
  expect(resolvesSilently("comment", "my words", "their words")).toBe(false);
});

it("never resolves a delete silently, because it names no value to compare", () => {
  expect(resolvesSilently("delete", null, null)).toBe(false);
});
