import { describe, expect, it } from "vitest";

import { parseAttachmentPath } from "./zt-attach";
import type { LinkMode } from "./zt-attach";

/** A key that matches Zotero's 8-character key format. */
const VALID_KEY = "ATCH2345";

describe("parseAttachmentPath", () => {
  it.each<[string, LinkMode]>([
    ["imported_file", 0],
    ["imported_url", 1],
    ["embedded_image", 4],
  ])("strips the storage: prefix for %s (linkMode %i)", (_name, linkMode) => {
    expect(
      parseAttachmentPath("storage:paper.pdf", linkMode, VALID_KEY),
    ).toEqual({
      kind: "storage",
      filename: "paper.pdf",
    });
  });

  it("flags storage-mode rows missing the prefix as unknown", () => {
    expect(parseAttachmentPath("paper.pdf", 0, VALID_KEY)).toEqual({
      kind: "unknown",
      raw: "paper.pdf",
    });
  });

  it.each([
    ["a forward slash", "storage:sub/paper.pdf"],
    ["a backslash", "storage:sub\\paper.pdf"],
    ["mixed separators", "storage:sub\\deeper/paper.pdf"],
    ["a leading forward slash (absolute)", "storage:/etc/passwd"],
    ["a parent segment as the whole filename", "storage:.."],
    ["a Windows drive-absolute form", "storage:C:\\paper.pdf"],
    ["a Windows drive-relative form", "storage:C:paper.pdf"],
    ["a UNC form", "storage:\\\\server\\share\\paper.pdf"],
  ])("flags a storage filename carrying %s as unknown", (_name, path) => {
    expect(parseAttachmentPath(path, 0, VALID_KEY)).toEqual({
      kind: "unknown",
      raw: path,
    });
  });

  it.each([
    ["empty", ""],
    ["too short", "ABC123"],
    ["lowercase", "atch2345"],
    ["containing a forward slash", "ATCH23/5"],
    ["containing a backslash", "ATCH23\\5"],
    ["containing a disallowed character (0/1/O)", "ATCH01O5"],
  ])("flags a storage row with an %s item key as unknown", (_name, key) => {
    expect(parseAttachmentPath("storage:paper.pdf", 0, key)).toEqual({
      kind: "unknown",
      raw: "storage:paper.pdf",
    });
  });

  it.each([
    ["a POSIX filename carrying a plain colon", "storage:notes:final.pdf"],
  ])("resolves a storage filename carrying %s", (_name, path) => {
    expect(parseAttachmentPath(path, 0, VALID_KEY)).toEqual({
      kind: "storage",
      filename: path.slice("storage:".length),
    });
  });

  it("strips the attachments: placeholder for linked_file (base-dir)", () => {
    expect(
      parseAttachmentPath("attachments:vendor/paper.pdf", 2, VALID_KEY),
    ).toEqual({
      kind: "linked-base",
      relative: "vendor/paper.pdf",
    });
  });

  it("returns linked-absolute for linked_file without the placeholder", () => {
    expect(
      parseAttachmentPath("/Users/me/papers/foo.pdf", 2, VALID_KEY),
    ).toEqual({
      kind: "linked-absolute",
      path: "/Users/me/papers/foo.pdf",
    });
  });

  it("returns the raw URL for linked_url", () => {
    expect(
      parseAttachmentPath("https://example.com/x.pdf", 3, VALID_KEY),
    ).toEqual({
      kind: "linked-url",
      url: "https://example.com/x.pdf",
    });
  });

  it("flags a linked_file row with a malformed item key as unknown", () => {
    expect(
      parseAttachmentPath("/Users/me/papers/foo.pdf", 2, "not-a-key"),
    ).toEqual({
      kind: "unknown",
      raw: "/Users/me/papers/foo.pdf",
    });
  });

  it("flags a linked_url row with a malformed item key as unknown", () => {
    expect(
      parseAttachmentPath("https://example.com/x.pdf", 3, "not-a-key"),
    ).toEqual({
      kind: "unknown",
      raw: "https://example.com/x.pdf",
    });
  });

  it.each([null, ""])("returns unknown for empty path (%p)", (path) => {
    expect(parseAttachmentPath(path, 0, VALID_KEY)).toEqual({
      kind: "unknown",
      raw: path,
    });
  });

  it("returns unknown for null linkMode", () => {
    expect(parseAttachmentPath("storage:paper.pdf", null, VALID_KEY)).toEqual({
      kind: "unknown",
      raw: "storage:paper.pdf",
    });
  });

  it("returns unknown for out-of-range linkMode", () => {
    expect(
      parseAttachmentPath("storage:paper.pdf", 99 as LinkMode, VALID_KEY),
    ).toEqual({
      kind: "unknown",
      raw: "storage:paper.pdf",
    });
  });
});
