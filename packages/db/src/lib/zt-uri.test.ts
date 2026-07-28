import { describe, expect, it } from "vitest";

import {
  annotationOpenUri,
  attachmentOpenUri,
  itemSelectUri,
  itemWebUrl,
} from "./zt-uri";

describe("itemSelectUri", () => {
  it("uses the library path for personal items", () => {
    expect(itemSelectUri("ABC12345", null)).toBe(
      "zotero://select/library/items/ABC12345",
    );
  });

  it("uses the group path for group items", () => {
    expect(itemSelectUri("ABC12345", 42)).toBe(
      "zotero://select/groups/42/items/ABC12345",
    );
  });
});

describe("attachmentOpenUri", () => {
  it("links to a personal-library attachment", () => {
    expect(attachmentOpenUri("ATCH1234", null)).toBe(
      "zotero://open/library/items/ATCH1234",
    );
  });

  it("links to a group-library attachment", () => {
    expect(attachmentOpenUri("ATCH1234", 7)).toBe(
      "zotero://open/groups/7/items/ATCH1234",
    );
  });
});

describe("annotationOpenUri", () => {
  it("links to the annotation within its attachment with a page hint", () => {
    expect(
      annotationOpenUri({
        attachmentKey: "ATCH1234",
        annotationKey: "ANNO5678",
        pageLabel: "12",
        groupID: null,
      }),
    ).toBe("zotero://open/library/items/ATCH1234?annotation=ANNO5678&page=12");
  });

  it("omits the page hint when there is no page label", () => {
    expect(
      annotationOpenUri({
        attachmentKey: "ATCH1234",
        annotationKey: "ANNO5678",
        pageLabel: null,
        groupID: 7,
      }),
    ).toBe("zotero://open/groups/7/items/ATCH1234?annotation=ANNO5678");
  });

  it("percent-encodes a page label exactly once so it round-trips through URL parsing", () => {
    const pageLabel = "S. 12";
    const uri = annotationOpenUri({
      attachmentKey: "ATCH1234",
      annotationKey: "ANNO5678",
      pageLabel,
      groupID: null,
    });
    expect(new URL(uri).searchParams.get("page")).toBe(pageLabel);
  });
});

describe("itemWebUrl", () => {
  it("uses the groups URL when a groupID is present", () => {
    expect(itemWebUrl("ABC12345", 42, "aidenlx")).toBe(
      "https://www.zotero.org/groups/42/items/ABC12345",
    );
  });

  it("uses the groups URL even when username is null", () => {
    expect(itemWebUrl("ABC12345", 42, null)).toBe(
      "https://www.zotero.org/groups/42/items/ABC12345",
    );
  });

  it("uses the username slug URL for a personal item with a known username", () => {
    expect(itemWebUrl("ABC12345", null, "aidenlx")).toBe(
      "https://www.zotero.org/aidenlx/items/ABC12345",
    );
  });

  it("returns null for a personal item with no username", () => {
    expect(itemWebUrl("ABC12345", null, null)).toBeNull();
  });

  it("slugifies the username: spaces to underscores", () => {
    expect(itemWebUrl("ABC12345", null, "Aiden LX")).toBe(
      "https://www.zotero.org/aiden_lx/items/ABC12345",
    );
  });

  it("slugifies the username: strips chars outside [a-z0-9 ._-]", () => {
    expect(itemWebUrl("ABC12345", null, "user@name!")).toBe(
      "https://www.zotero.org/username/items/ABC12345",
    );
  });
});
