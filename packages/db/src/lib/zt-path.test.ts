import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { type Attachment } from "./zt-attach";
import { attachmentAbsPath, resolveAnnotCachePath } from "./zt-path";

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 1,
    libraryID: 1,
    key: "ATTACH1",
    parentItemID: 2,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("resolveAnnotCachePath", () => {
  it("resolves personal-library annotation cache images", () => {
    expect(
      resolveAnnotCachePath({
        annotKey: "ANNOT1",
        groupID: null,
        dataDir: "/zotero",
      }),
    ).toBe("/zotero/cache/library/ANNOT1.png");
  });

  it("resolves group annotation cache images", () => {
    expect(
      resolveAnnotCachePath({
        annotKey: "ANNOT1",
        groupID: 42,
        dataDir: "/zotero",
      }),
    ).toBe("/zotero/cache/groups/42/ANNOT1.png");
  });
});

describe("attachmentAbsPath", () => {
  it("resolves embedded-image storage attachments", () => {
    expect(
      attachmentAbsPath(
        attachment({ key: "IMGKEY", path: "storage:image.png", linkMode: 4 }),
        { dataDir: "/zotero", baseAttachmentPath: null },
      ),
    ).toBe("/zotero/storage/IMGKEY/image.png");
  });

  it("returns absolute linked-file paths verbatim", () => {
    expect(
      attachmentAbsPath(attachment({ path: "/abs/doc.pdf", linkMode: 2 }), {
        dataDir: "/zotero",
        baseAttachmentPath: "/base",
      }),
    ).toBe("/abs/doc.pdf");
  });

  it("joins base-dir linked files onto baseAttachmentPath", () => {
    expect(
      attachmentAbsPath(
        attachment({ path: "attachments:sub/doc.pdf", linkMode: 2 }),
        { dataDir: "/zotero", baseAttachmentPath: "/base" },
      ),
    ).toBe("/base/sub/doc.pdf");
  });

  it("returns null for base-dir linked files when baseAttachmentPath is unset", () => {
    expect(
      attachmentAbsPath(
        attachment({ path: "attachments:sub/doc.pdf", linkMode: 2 }),
        { dataDir: "/zotero", baseAttachmentPath: null },
      ),
    ).toBeNull();
  });

  it("returns null for linked-url and unparseable attachments", () => {
    const ctx = { dataDir: "/zotero", baseAttachmentPath: "/base" };
    expect(
      attachmentAbsPath(
        attachment({ path: "https://example.com/x.pdf", linkMode: 3 }),
        ctx,
      ),
    ).toBeNull();
    expect(
      attachmentAbsPath(attachment({ path: null, linkMode: 0 }), ctx),
    ).toBeNull();
  });
});
