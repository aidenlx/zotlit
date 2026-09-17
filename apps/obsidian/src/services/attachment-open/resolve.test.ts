import { describe, expect, it } from "vitest";

import type { Attachment } from "@zotlit/db";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { obsidianOpenPath, toObsidianOpenableAttachments } from "./resolve";

const DATA_DIR = "/Users/me/Zotero";

const pathContext: AttachmentPathContext = {
  dataDir: DATA_DIR,
  baseAttachmentPath: null,
};

/** A live Zotero Attachment row, as `getAttachmentsByParents` hands one over. */
function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 20,
    libraryID: 1,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 1,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("obsidianOpenPath", () => {
  it("names an in-vault file by its vault-relative path", () => {
    expect(
      obsidianOpenPath(
        "/Users/me/Vault/papers/Doe 2024.pdf",
        "/Users/me/Vault",
        "darwin",
      ),
    ).toBe("papers/Doe 2024.pdf");
  });

  it("recognises an in-vault file whose casing differs from the vault base on darwin, keeping the original casing", () => {
    expect(
      obsidianOpenPath(
        "/Users/ME/VAULT/Papers/Doe.pdf",
        "/Users/me/Vault",
        "darwin",
      ),
    ).toBe("Papers/Doe.pdf");
  });

  it("treats the same case-differing path as outside the vault on linux", () => {
    expect(
      obsidianOpenPath(
        "/Users/ME/VAULT/Papers/Doe.pdf",
        "/Users/me/Vault",
        "linux",
      ),
    ).toBe("file:/Users/ME/VAULT/Papers/Doe.pdf");
  });

  it("does not treat a merely string-prefixed path as inside the vault", () => {
    expect(
      obsidianOpenPath(
        "/Users/me/Vaultastic/paper.pdf",
        "/Users/me/Vault",
        "darwin",
      ),
    ).toBe("file:/Users/me/Vaultastic/paper.pdf");
  });

  it("normalises a Windows path with backslashes on win32", () => {
    expect(
      obsidianOpenPath(
        "C:\\Users\\me\\Vault\\Papers\\Doe.pdf",
        "C:\\Users\\me\\Vault",
        "win32",
      ),
    ).toBe("Papers/Doe.pdf");
  });

  it("file:-prefixes an outside-vault file's absolute path", () => {
    expect(
      obsidianOpenPath(
        "/Users/me/Downloads/paper.pdf",
        "/Users/me/Vault",
        "darwin",
      ),
    ).toBe("file:/Users/me/Downloads/paper.pdf");
  });

  it("normalises a Windows path's backslashes before file:-prefixing an outside-vault file", () => {
    expect(
      obsidianOpenPath(
        "C:\\Users\\me\\Downloads\\paper.pdf",
        "C:\\Users\\me\\Vault",
        "win32",
      ),
    ).toBe("file:C:/Users/me/Downloads/paper.pdf");
  });
});

describe("toObsidianOpenableAttachments", () => {
  const ctx = {
    pathContext,
    vaultBasePath: "/Users/me/Vault",
    platform: "darwin" as NodeJS.Platform,
  };

  it("keeps a PDF named by its content type", () => {
    const result = toObsidianOpenableAttachments(
      [
        attachment({
          path: "storage:Doe.pdf",
          linkMode: 0,
          contentType: "application/pdf",
        }),
      ],
      ctx,
    );

    expect(result).toStrictEqual([
      {
        indexedKey: "ATCH2345",
        label: "Doe.pdf",
        openPath: `file:${DATA_DIR}/storage/ATCH2345/Doe.pdf`,
        absolutePath: `${DATA_DIR}/storage/ATCH2345/Doe.pdf`,
      },
    ]);
  });

  it("drops a non-PDF snapshot", () => {
    const result = toObsidianOpenableAttachments(
      [
        attachment({
          path: "storage:page.html",
          linkMode: 1,
          contentType: "text/html",
        }),
      ],
      ctx,
    );

    expect(result).toStrictEqual([]);
  });

  it("drops a linked_url row, whose path resolves to no file", () => {
    const result = toObsidianOpenableAttachments(
      [
        attachment({
          path: "https://example.com/paper",
          linkMode: 3,
          contentType: "application/pdf",
        }),
      ],
      ctx,
    );

    expect(result).toStrictEqual([]);
  });

  it("keeps a null-contentType .pdf via the extension fallback", () => {
    const result = toObsidianOpenableAttachments(
      [
        attachment({
          path: "/Papers/thesis.pdf",
          linkMode: 2,
          contentType: null,
        }),
      ],
      ctx,
    );

    expect(result).toStrictEqual([
      {
        indexedKey: "ATCH2345",
        label: "thesis.pdf",
        openPath: "file:/Papers/thesis.pdf",
        absolutePath: "/Papers/thesis.pdf",
      },
    ]);
  });

  it("drops a null-contentType .epub", () => {
    const result = toObsidianOpenableAttachments(
      [
        attachment({
          path: "/Papers/book.epub",
          linkMode: 2,
          contentType: null,
        }),
      ],
      ctx,
    );

    expect(result).toStrictEqual([]);
  });
});
