import { describe, expect, it } from "vitest";

import { type Attachment } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { attachmentAbsPath, attachmentFileLink } from "./file-link";

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 1,
    libraryID: 1,
    key: "ATCH1234",
    parentItemID: 2,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ctx = { dataDir: "/data", baseAttachmentPath: "/base" };

describe("attachmentAbsPath", () => {
  it("resolves a storage path under the data dir", () => {
    expect(
      attachmentAbsPath(
        makeAttachment({ path: "storage:paper.pdf", linkMode: 0 }),
        ctx,
      ),
    ).toBe("/data/storage/ATCH1234/paper.pdf");
  });

  it("passes an absolute linked path through", () => {
    expect(
      attachmentAbsPath(
        makeAttachment({ path: "/abs/file.pdf", linkMode: 2 }),
        ctx,
      ),
    ).toBe("/abs/file.pdf");
  });

  it("resolves a base-relative linked path against the base dir", () => {
    expect(
      attachmentAbsPath(
        makeAttachment({ path: "attachments:sub/file.pdf", linkMode: 2 }),
        ctx,
      ),
    ).toBe("/base/sub/file.pdf");
  });

  it("returns null for a base-relative path with no base configured", () => {
    expect(
      attachmentAbsPath(
        makeAttachment({ path: "attachments:sub/file.pdf", linkMode: 2 }),
        { dataDir: "/data", baseAttachmentPath: null },
      ),
    ).toBeNull();
  });

  it("returns null for URL links", () => {
    expect(
      attachmentAbsPath(
        makeAttachment({ path: "https://example.com", linkMode: 3 }),
        ctx,
      ),
    ).toBeNull();
  });
});

describe("attachmentFileLink", () => {
  it("builds a file link labelled with the basename", () => {
    expect(
      attachmentFileLink(
        makeAttachment({ path: "storage:paper.pdf", linkMode: 0 }),
        ctx,
      ),
    ).toBe("[paper.pdf](file:///data/storage/ATCH1234/paper.pdf)");
  });

  it("returns empty string for an unresolvable attachment", () => {
    expect(
      attachmentFileLink(
        makeAttachment({ path: "https://example.com", linkMode: 3 }),
        ctx,
      ),
    ).toBe("");
  });
});
