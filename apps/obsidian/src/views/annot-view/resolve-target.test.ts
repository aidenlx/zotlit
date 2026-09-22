import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import type { ReaderSessionTarget } from "@/services/reader-session/session";

import { resolveLibraryID, resolveLoadTarget } from "./resolve-target";

const GROUP_LIBRARY: Library = {
  libraryID: 42,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 7,
  name: "Shared",
};

const USER_PAPER: ReaderSessionTarget = {
  attachmentKey: "ATCH2345",
  itemKey: "AAAA2345",
};

const GROUP_PAPER: ReaderSessionTarget = {
  attachmentKey: "ATCH2345g7",
  itemKey: "BBBB2345g7",
};

const STANDALONE: ReaderSessionTarget = {
  attachmentKey: "LSTAND23",
  itemKey: null,
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

describe("resolveLoadTarget — Active Tab", () => {
  it("resolves a Literature Note's own Item, with nothing locked", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "note", itemKey: "AAAA2345" },
        libraries: null,
      }),
    ).toEqual({
      itemKey: "AAAA2345",
      lockedAttachmentKey: null,
      lock: null,
      key: "AAAA2345",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
    });
  });

  it("resolves a group note key through the library list", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "note", itemKey: "BBBB2345g7" },
        libraries: [GROUP_LIBRARY],
      }),
    ).toEqual({
      itemKey: "BBBB2345g7",
      lockedAttachmentKey: null,
      lock: null,
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
    });
  });

  it("locks the Attachment an open Obsidian PDF holds", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "pdf", target: USER_PAPER },
        libraries: null,
      }),
    ).toEqual({
      itemKey: "AAAA2345",
      lockedAttachmentKey: "ATCH2345",
      lock: "obsidian-pdf",
      key: "AAAA2345",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
    });
  });

  it("resolves a standalone Attachment through its own key", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "pdf", target: STANDALONE },
        libraries: null,
      }),
    ).toEqual({
      itemKey: null,
      lockedAttachmentKey: "LSTAND23",
      lock: "obsidian-pdf",
      key: "LSTAND23",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
    });
  });

  it("returns null when the active tab names nothing", () => {
    expect(
      resolveLoadTarget({ mode: "active-tab", leaf: null, libraries: null }),
    ).toBeNull();
  });

  it("returns null for a malformed key", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "note", itemKey: "not-a-key" },
        libraries: null,
      }),
    ).toBeNull();
  });

  it("returns null when a group's library is not loaded", () => {
    expect(
      resolveLoadTarget({
        mode: "active-tab",
        leaf: { kind: "note", itemKey: "BBBB2345g7" },
        libraries: [],
      }),
    ).toBeNull();
  });
});

describe("resolveLoadTarget — Zotero Reader", () => {
  it("locks the Attachment the Zotero reader holds", () => {
    expect(
      resolveLoadTarget({
        mode: "zotero-reader",
        target: GROUP_PAPER,
        libraries: [GROUP_LIBRARY],
      }),
    ).toEqual({
      itemKey: "BBBB2345g7",
      lockedAttachmentKey: "ATCH2345g7",
      lock: "zotero-reader",
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
    });
  });

  it("returns null while the Zotero reader names nothing", () => {
    expect(
      resolveLoadTarget({
        mode: "zotero-reader",
        target: null,
        libraries: null,
      }),
    ).toBeNull();
  });
});

describe("resolveLoadTarget — Pinned", () => {
  it("resolves the pinned Item with the picker left live", () => {
    expect(
      resolveLoadTarget({
        mode: "pinned",
        pinnedItemKey: "BBBB2345g7",
        libraries: [GROUP_LIBRARY],
      }),
    ).toEqual({
      itemKey: "BBBB2345g7",
      lockedAttachmentKey: null,
      lock: null,
      key: "BBBB2345",
      libraryID: 42,
      groupID: 7,
    });
  });

  it("returns null when nothing is pinned", () => {
    expect(
      resolveLoadTarget({
        mode: "pinned",
        pinnedItemKey: null,
        libraries: null,
      }),
    ).toBeNull();
  });
});
