import { describe, expect, it } from "vitest";

import {
  ANNOTATION_ANCHOR_KEY,
  formatAnnotationSubpath,
  parseAnnotationSubpath,
} from "./zt-annot-anchor";

describe("formatAnnotationSubpath", () => {
  it("writes the Anchor beside the page Obsidian jumps to", () => {
    expect(formatAnnotationSubpath({ page: 4, annotation: "ABCD2345" })).toBe(
      "#page=4&zt-annotation=ABCD2345",
    );
  });

  it("writes the page alone for an Annotation it was given no key for", () => {
    expect(formatAnnotationSubpath({ page: 4 })).toBe("#page=4");
  });

  it("writes the Anchor alone for an Annotation on no page", () => {
    expect(formatAnnotationSubpath({ annotation: "ABCD2345" })).toBe(
      "#zt-annotation=ABCD2345",
    );
  });

  it("writes nothing when it is given neither", () => {
    expect(formatAnnotationSubpath({ page: null, annotation: null })).toBe("");
  });

  it("writes a group library's Indexed Key whole", () => {
    expect(
      formatAnnotationSubpath({ page: 2, annotation: "ABCD2345g5678" }),
    ).toBe("#page=2&zt-annotation=ABCD2345g5678");
  });

  it("leaves out a key that is no Indexed Key", () => {
    expect(formatAnnotationSubpath({ page: 4, annotation: "not a key" })).toBe(
      "#page=4",
    );
  });
});

describe("parseAnnotationSubpath", () => {
  it("reads back what the formatter wrote", () => {
    const anchor = { page: 4, annotation: "ABCD2345" };
    expect(parseAnnotationSubpath(formatAnnotationSubpath(anchor))).toEqual(
      anchor,
    );
  });

  it("reads back a group library's Indexed Key", () => {
    const anchor = { page: 2, annotation: "ABCD2345g5678" };
    expect(parseAnnotationSubpath(formatAnnotationSubpath(anchor))).toEqual(
      anchor,
    );
  });

  // Obsidian reads `page`, `offset`, `annotation`, `selection` and `height` by
  // name; a fragment carrying them is one ZotLit reads its own key out of and
  // leaves alone.
  it("reads its own key out of a fragment Obsidian also owns keys in", () => {
    expect(
      parseAnnotationSubpath(
        "#page=4&selection=1,2,3,4&annotation=17R&zt-annotation=ABCD2345",
      ),
    ).toEqual({ page: 4, annotation: "ABCD2345" });
  });

  it("reads a fragment written without its leading hash", () => {
    expect(parseAnnotationSubpath("page=4&zt-annotation=ABCD2345")).toEqual({
      page: 4,
      annotation: "ABCD2345",
    });
  });

  it("names no Annotation for a fragment carrying no Anchor", () => {
    expect(parseAnnotationSubpath("#page=4")).toEqual({
      page: 4,
      annotation: null,
    });
  });

  it("names no Annotation for a key that is no Indexed Key", () => {
    expect(
      parseAnnotationSubpath(`#page=4&${ANNOTATION_ANCHOR_KEY}=not a key`),
    ).toEqual({ page: 4, annotation: null });
  });

  it("names no page for a page that is no page number", () => {
    expect(parseAnnotationSubpath("#page=last&zt-annotation=ABCD2345")).toEqual(
      { page: null, annotation: "ABCD2345" },
    );
  });

  it.each([[""], [undefined], [null]])(
    "reads %s as an empty fragment",
    (subpath) => {
      expect(parseAnnotationSubpath(subpath)).toEqual({
        page: null,
        annotation: null,
      });
    },
  );
});
