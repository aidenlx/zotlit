import { describe, expect, it } from "vitest";

import { parseAttachmentPath } from "./zt-attach";

describe("parseAttachmentPath", () => {
  it.each([
    ["imported_file", 0],
    ["imported_url", 1],
    ["embedded_image", 4],
  ])("strips the storage: prefix for %s (linkMode %i)", (_name, linkMode) => {
    expect(parseAttachmentPath("storage:paper.pdf", linkMode)).toEqual({
      kind: "storage",
      filename: "paper.pdf",
    });
  });

  it("flags storage-mode rows missing the prefix as unknown", () => {
    expect(parseAttachmentPath("paper.pdf", 0)).toEqual({
      kind: "unknown",
      raw: "paper.pdf",
    });
  });

  it("strips the attachments: placeholder for linked_file (base-dir)", () => {
    expect(parseAttachmentPath("attachments:vendor/paper.pdf", 2)).toEqual({
      kind: "linked-base",
      relative: "vendor/paper.pdf",
    });
  });

  it("returns linked-absolute for linked_file without the placeholder", () => {
    expect(parseAttachmentPath("/Users/me/papers/foo.pdf", 2)).toEqual({
      kind: "linked-absolute",
      path: "/Users/me/papers/foo.pdf",
    });
  });

  it("returns the raw URL for linked_url", () => {
    expect(parseAttachmentPath("https://example.com/x.pdf", 3)).toEqual({
      kind: "linked-url",
      url: "https://example.com/x.pdf",
    });
  });

  it.each([null, ""])("returns unknown for empty path (%p)", (path) => {
    expect(parseAttachmentPath(path, 0)).toEqual({
      kind: "unknown",
      raw: path,
    });
  });

  it("returns unknown for null linkMode", () => {
    expect(parseAttachmentPath("storage:paper.pdf", null)).toEqual({
      kind: "unknown",
      raw: "storage:paper.pdf",
    });
  });

  it("returns unknown for out-of-range linkMode", () => {
    expect(parseAttachmentPath("storage:paper.pdf", 99)).toEqual({
      kind: "unknown",
      raw: "storage:paper.pdf",
    });
  });
});
