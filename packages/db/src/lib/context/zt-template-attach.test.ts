import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { USER_LIBRARY_ID } from "@/lib/constants";
import type { Attachment } from "@/lib/zt-attach";

import { attachmentToTemplateData } from "./zt-template-attach";

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 2,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("attachmentToTemplateData", () => {
  it("resolves a stored-file filename and link mode", () => {
    const result = attachmentToTemplateData(
      makeAttachment({
        path: "storage:paper.pdf",
        contentType: "application/pdf",
        linkMode: 0,
      }),
    );

    expect(result.filename).toBe("paper.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.linkMode).toBe("imported_file");
  });

  it("includes a backlink for the personal library", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ key: "XYZ789", groupID: null }),
    );

    expect(result.backlink).toBe("zotero://open/library/items/XYZ789");
  });

  it("includes a backlink for a group library", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ key: "XYZ789", groupID: 42 }),
    );

    expect(result.backlink).toBe("zotero://open/groups/42/items/XYZ789");
  });

  it("passes through the bare indexedKey for the personal library", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ key: "XYZ789", indexedKey: "XYZ789", groupID: null }),
    );

    expect(result.indexedKey).toBe("XYZ789");
  });

  it("passes through the scoped indexedKey for a group library", () => {
    const result = attachmentToTemplateData(
      makeAttachment({
        key: "XYZ789",
        indexedKey: "XYZ789g42",
        groupID: 42,
      }),
    );

    expect(result.indexedKey).toBe("XYZ789g42");
  });

  it("takes the basename of an absolute linked path", () => {
    const result = attachmentToTemplateData(
      makeAttachment({
        path: "/Users/x/Documents/refs/book.epub",
        linkMode: 2,
      }),
    );

    expect(result.filename).toBe("book.epub");
    expect(result.linkMode).toBe("linked_file");
  });

  it("takes the basename of a base-relative linked path", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ path: "attachments:sub/dir/notes.pdf", linkMode: 2 }),
    );

    expect(result.filename).toBe("notes.pdf");
  });

  it("yields a null filename for linked URLs", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ path: "https://example.com/a", linkMode: 3 }),
    );

    expect(result.filename).toBeNull();
    expect(result.linkMode).toBe("linked_url");
  });

  it("yields a null filename for a malformed item key", () => {
    const result = attachmentToTemplateData(
      makeAttachment({
        path: "storage:paper.pdf",
        linkMode: 0,
        key: "not-a-key",
      }),
    );

    expect(result.filename).toBeNull();
  });

  it("marks an unknown link mode", () => {
    const result = attachmentToTemplateData(makeAttachment({ linkMode: null }));

    expect(result.filename).toBeNull();
    expect(result.linkMode).toBe("unknown");
  });

  it("normalizes an empty-string contentType to null", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ contentType: "" }),
    );

    expect(result.contentType).toBeNull();
  });

  it("omits the runtime filePath and fileLink fields", () => {
    const result = attachmentToTemplateData(
      makeAttachment({ path: "storage:a.pdf", linkMode: 0 }),
    );

    expect("filePath" in result).toBe(false);
    expect("fileLink" in result).toBe(false);
  });
});
