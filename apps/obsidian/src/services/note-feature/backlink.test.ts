import { describe, expect, it } from "vitest";

import {
  annotationBacklink,
  groupIDFromIndexedKey,
  itemBacklink,
} from "./backlink";

describe("groupIDFromIndexedKey", () => {
  it("returns null for a personal-library key", () => {
    expect(groupIDFromIndexedKey("ABC12345", "ABC12345")).toBeNull();
  });

  it("extracts the group id from a group key", () => {
    expect(groupIDFromIndexedKey("ABC12345g42", "ABC12345")).toBe(42);
  });
});

describe("itemBacklink", () => {
  it("uses the library path for personal items", () => {
    expect(itemBacklink("ABC12345", null)).toBe(
      "zotero://select/library/items/ABC12345",
    );
  });

  it("uses the group path for group items", () => {
    expect(itemBacklink("ABC12345", 42)).toBe(
      "zotero://select/groups/42/items/ABC12345",
    );
  });
});

describe("annotationBacklink", () => {
  it("links to the annotation within its attachment with a page hint", () => {
    expect(
      annotationBacklink({
        attachmentKey: "ATCH1234",
        annotationKey: "ANNO5678",
        pageLabel: "12",
        groupID: null,
      }),
    ).toBe("zotero://open/library/items/ATCH1234?page=12&annotation=ANNO5678");
  });

  it("omits the page hint when there is no page label", () => {
    expect(
      annotationBacklink({
        attachmentKey: "ATCH1234",
        annotationKey: "ANNO5678",
        pageLabel: null,
        groupID: 7,
      }),
    ).toBe("zotero://open/groups/7/items/ATCH1234?annotation=ANNO5678");
  });
});
