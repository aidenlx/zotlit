import { describe, expect, it } from "vitest";

import {
  parseAnnotViewState,
  serializeAnnotViewState,
  unpinnedMode,
} from "./view-state";

const PINNED_KEY = "ABCD2345";

describe("parseAnnotViewState — the names before ADR 0041", () => {
  it("renames each of the three stored modes", () => {
    expect(parseAnnotViewState({ followMode: "note" }).followMode).toBe(
      "active-tab",
    );
    expect(parseAnnotViewState({ followMode: "reader" }).followMode).toBe(
      "zotero-reader",
    );
    expect(
      parseAnnotViewState({
        followMode: "linked",
        linkedIndexedKey: PINNED_KEY,
      }),
    ).toEqual({
      followMode: "pinned",
      previousMode: "active-tab",
      pinnedItemKey: PINNED_KEY,
    });
  });

  it("keeps a group library's pinned key whole", () => {
    expect(
      parseAnnotViewState({
        followMode: "linked",
        linkedIndexedKey: "ABCD2345g4200309",
      }).pinnedItemKey,
    ).toBe("ABCD2345g4200309");
  });

  it("restores Zotero Reader even though its source may not answer", () => {
    // The mode is the user's choice, so the restore keeps it and the view says
    // in place why the source is silent.
    expect(parseAnnotViewState({ followMode: "reader" })).toEqual({
      followMode: "zotero-reader",
      previousMode: "active-tab",
      pinnedItemKey: null,
    });
  });
});

describe("parseAnnotViewState — a value this build cannot use", () => {
  it("takes the default for an unknown mode", () => {
    expect(parseAnnotViewState({ followMode: "telepathy" })).toEqual({
      followMode: "active-tab",
      previousMode: "active-tab",
      pinnedItemKey: null,
    });
  });

  it("takes the default for state that is not an object at all", () => {
    for (const raw of [null, undefined, "pinned", 7, []]) {
      expect(parseAnnotViewState(raw).followMode).toBe("active-tab");
    }
  });

  it("drops a pin whose key is not an Indexed Key", () => {
    expect(
      parseAnnotViewState({
        followMode: "pinned",
        pinnedItemKey: "not a key",
      }),
    ).toEqual({
      followMode: "active-tab",
      previousMode: "active-tab",
      pinnedItemKey: null,
    });
  });

  it("returns a pin with no key to the mode the pin interrupted", () => {
    expect(
      parseAnnotViewState({
        followMode: "pinned",
        previousMode: "zotero-reader",
      }),
    ).toEqual({
      followMode: "zotero-reader",
      previousMode: "active-tab",
      pinnedItemKey: null,
    });
  });

  it("never lets a pin be what Unpin returns to", () => {
    expect(
      parseAnnotViewState({
        followMode: "pinned",
        previousMode: "pinned",
        pinnedItemKey: PINNED_KEY,
      }).previousMode,
    ).toBe("active-tab");
    expect(unpinnedMode("pinned")).toBe("active-tab");
    expect(unpinnedMode("zotero-reader")).toBe("zotero-reader");
  });
});

describe("serializeAnnotViewState", () => {
  it("round-trips through the parser", () => {
    const state = {
      followMode: "pinned",
      previousMode: "zotero-reader",
      pinnedItemKey: PINNED_KEY,
    } as const;
    expect(parseAnnotViewState(serializeAnnotViewState(state))).toEqual(state);
  });

  it("writes no pinned key while nothing is pinned", () => {
    expect(
      serializeAnnotViewState({
        followMode: "active-tab",
        previousMode: "active-tab",
        pinnedItemKey: null,
      }),
    ).toEqual({ followMode: "active-tab", previousMode: "active-tab" });
  });
});
