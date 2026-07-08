import { describe, expect, it } from "vitest";

import { type ItemRef, type Library, USER_LIBRARY_ID } from "@zotlit/db";

import { resolveLibraryID, resolveLoadTarget } from "./resolve-target";

const GROUP_LIBRARY: Library = {
  libraryID: 42,
  type: "group",
  groupID: 7,
  name: "Shared",
};

const USER_REF: ItemRef = {
  itemID: 100,
  key: "AAAA2345",
  libraryID: USER_LIBRARY_ID,
  groupID: null,
  indexedKey: "AAAA2345",
};

const GROUP_REF: ItemRef = {
  itemID: 200,
  key: "BBBB2345",
  libraryID: 42,
  groupID: 7,
  indexedKey: "BBBB2345g7",
};

describe("resolveLibraryID", () => {
  it("maps a null group to the user library", () => {
    expect(resolveLibraryID(null, null)).toBe(USER_LIBRARY_ID);
    expect(resolveLibraryID(null, [GROUP_LIBRARY])).toBe(USER_LIBRARY_ID);
  });

  it("resolves a known group to its library id", () => {
    expect(resolveLibraryID(7, [GROUP_LIBRARY])).toBe(42);
  });

  it("returns null for an unknown group or missing library list", () => {
    expect(resolveLibraryID(7, [])).toBeNull();
    expect(resolveLibraryID(7, null)).toBeNull();
    expect(resolveLibraryID(9, [GROUP_LIBRARY])).toBeNull();
  });
});

describe("resolveLoadTarget — note mode", () => {
  it("resolves a personal-library note key", () => {
    expect(
      resolveLoadTarget({
        mode: "note",
        indexedKey: "AAAA2345",
        libraries: null,
      }),
    ).toEqual({
      indexedKey: "AAAA2345",
      key: "AAAA2345",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      boundAttachmentID: null,
    });
  });

  it("resolves a group note key through the library list", () => {
    expect(
      resolveLoadTarget({
        mode: "note",
        indexedKey: "BBBB2345g7",
        libraries: [GROUP_LIBRARY],
      }),
    ).toEqual({
      indexedKey: "BBBB2345g7",
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
      boundAttachmentID: null,
    });
  });

  it("returns null when there is no active note key", () => {
    expect(
      resolveLoadTarget({ mode: "note", indexedKey: null, libraries: null }),
    ).toBeNull();
  });

  it("returns null for a malformed key", () => {
    expect(
      resolveLoadTarget({
        mode: "note",
        indexedKey: "not-a-key",
        libraries: null,
      }),
    ).toBeNull();
  });

  it("returns null when a group's library is not loaded", () => {
    expect(
      resolveLoadTarget({
        mode: "note",
        indexedKey: "BBBB2345g7",
        libraries: [],
      }),
    ).toBeNull();
  });
});

describe("resolveLoadTarget — reader mode", () => {
  it("binds the reader's attachment to the resolved ref", () => {
    expect(
      resolveLoadTarget({ mode: "reader", ref: GROUP_REF, attachmentID: 555 }),
    ).toEqual({
      indexedKey: "BBBB2345g7",
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
      boundAttachmentID: 555,
    });
  });

  it("passes a null attachment through unbound", () => {
    expect(
      resolveLoadTarget({ mode: "reader", ref: USER_REF, attachmentID: null }),
    ).toMatchObject({ key: "AAAA2345", boundAttachmentID: null });
  });

  it("returns null when the reader ref does not resolve", () => {
    expect(
      resolveLoadTarget({ mode: "reader", ref: null, attachmentID: 555 }),
    ).toBeNull();
  });
});

describe("resolveLoadTarget — linked mode", () => {
  it("resolves the pinned ref with no bound attachment", () => {
    expect(
      resolveLoadTarget({ mode: "linked", linkedTarget: GROUP_REF }),
    ).toEqual({
      indexedKey: "BBBB2345g7",
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
      boundAttachmentID: null,
    });
  });

  it("returns null when nothing is pinned", () => {
    expect(
      resolveLoadTarget({ mode: "linked", linkedTarget: null }),
    ).toBeNull();
  });
});
