import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@/lib/constants";

import type { Attachment } from "./zt-attach";
import {
  attachmentAbsPath,
  attachmentPathKey,
  normalizeAbsolutePath,
  resolveAnnotCachePath,
} from "./zt-path";

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    key: "ATTACH23",
    indexedKey: "ATTACH23",
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
  it("resolves personal-library image/ink annotation cache images", () => {
    expect(
      resolveAnnotCachePath(
        { key: "ANNOT1", type: 3 },
        { groupID: null, dataDir: "/zotero" },
      ),
    ).toBe("/zotero/cache/library/ANNOT1.png");
    expect(
      resolveAnnotCachePath(
        { key: "ANNOT1", type: 4 },
        { groupID: null, dataDir: "/zotero" },
      ),
    ).toBe("/zotero/cache/library/ANNOT1.png");
  });

  it("resolves group annotation cache images", () => {
    expect(
      resolveAnnotCachePath(
        { key: "ANNOT1", type: 3 },
        { groupID: 42, dataDir: "/zotero" },
      ),
    ).toBe("/zotero/cache/groups/42/ANNOT1.png");
  });

  it("returns null for annotation types Zotero never caches an image for", () => {
    for (const type of [1, 2, 5, 6] as const) {
      expect(
        resolveAnnotCachePath(
          { key: "ANNOT1", type },
          { groupID: null, dataDir: "/zotero" },
        ),
      ).toBeNull();
    }
  });
});

describe("attachmentAbsPath", () => {
  it("resolves embedded-image storage attachments", () => {
    expect(
      attachmentAbsPath(
        attachment({
          key: "IMGKEY23",
          path: "storage:image.png",
          linkMode: 4,
        }),
        { dataDir: "/zotero", baseAttachmentPath: null },
      ),
    ).toBe("/zotero/storage/IMGKEY23/image.png");
  });

  it.each([
    ["a forward slash", "storage:sub/image.png"],
    ["a backslash", "storage:sub\\image.png"],
    ["a parent segment", "storage:.."],
    ["a Windows drive-absolute form", "storage:C:\\image.png"],
    ["a UNC form", "storage:\\\\server\\share\\image.png"],
  ])(
    "resolves to no path for a stored-file location with %s",
    (_name, path) => {
      expect(
        attachmentAbsPath(attachment({ key: "IMGKEY23", path, linkMode: 4 }), {
          dataDir: "/zotero",
          baseAttachmentPath: null,
        }),
      ).toBeNull();
    },
  );

  it.each([
    ["empty", ""],
    ["malformed", "IMG"],
    ["containing a path separator", "IMG/KEY2"],
  ])(
    "resolves to no path for a stored-file row with an %s item key",
    (_name, key) => {
      expect(
        attachmentAbsPath(
          attachment({ key, path: "storage:image.png", linkMode: 4 }),
          { dataDir: "/zotero", baseAttachmentPath: null },
        ),
      ).toBeNull();
    },
  );

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

describe("normalizeAbsolutePath", () => {
  // Worked examples: the un-folded rule attachmentPathKey folds afterward.
  it.each([
    [
      "collapses a doubled separator",
      "/zotero//storage/RGRPDF24//rougier-2014.pdf",
      "/zotero/storage/RGRPDF24/rougier-2014.pdf",
    ],
    [
      "turns backslashes into forward slashes",
      "C:\\Users\\me\\Zotero\\storage\\RGRPDF24\\rougier-2014.pdf",
      "C:/Users/me/Zotero/storage/RGRPDF24/rougier-2014.pdf",
    ],
    [
      "resolves a parent segment",
      "/vault/attachments/../linked-files/rougier-2014.pdf",
      "/vault/linked-files/rougier-2014.pdf",
    ],
    ["drops a trailing separator", "/vault/attachments/", "/vault/attachments"],
    ["keeps the separator of a root path", "/", "/"],
  ])("%s", (_name, path, expected) => {
    expect(normalizeAbsolutePath(path)).toBe(expected);
  });

  it("keeps casing as written, unlike attachmentPathKey", () => {
    expect(normalizeAbsolutePath("/Vault/Attachments/Rougier-2014.PDF")).toBe(
      "/Vault/Attachments/Rougier-2014.PDF",
    );
  });
});

describe("attachmentPathKey", () => {
  // Worked examples: each input is a form one side of a lookup arrives in,
  // beside the single key both sides must fold onto.
  it.each([
    [
      "collapses a doubled separator",
      "/zotero//storage/RGRPDF24//rougier-2014.pdf",
      "/zotero/storage/RGRPDF24/rougier-2014.pdf",
    ],
    [
      "turns backslashes into forward slashes",
      "C:\\Users\\me\\Zotero\\storage\\RGRPDF24\\rougier-2014.pdf",
      "C:/Users/me/Zotero/storage/RGRPDF24/rougier-2014.pdf",
    ],
    [
      "collapses a mixed separator run",
      "C:\\Users\\/me\\\\rougier-2014.pdf",
      "C:/Users/me/rougier-2014.pdf",
    ],
    [
      "resolves a parent segment",
      "/vault/attachments/../linked-files/rougier-2014.pdf",
      "/vault/linked-files/rougier-2014.pdf",
    ],
    [
      "resolves a current-directory segment",
      "/vault/./attachments/rougier-2014.pdf",
      "/vault/attachments/rougier-2014.pdf",
    ],
    ["drops a trailing separator", "/vault/attachments/", "/vault/attachments"],
    [
      "drops a trailing separator run",
      "/vault/attachments\\\\",
      "/vault/attachments",
    ],
    ["keeps the separator of a root path", "/", "/"],
  ])("%s", (_name, path, expected) => {
    expect(attachmentPathKey(path, "linux")).toBe(expected);
  });

  it.each<NodeJS.Platform>(["darwin", "win32"])(
    "folds case on %s, where one file answers to both casings",
    (platform) => {
      expect(
        attachmentPathKey("/Vault/Attachments/Rougier-2014.PDF", platform),
      ).toBe("/vault/attachments/rougier-2014.pdf");
    },
  );

  it("keeps case on linux, where two casings are two files", () => {
    expect(attachmentPathKey("/vault/Rougier-2014.pdf", "linux")).toBe(
      "/vault/Rougier-2014.pdf",
    );
    expect(attachmentPathKey("/vault/rougier-2014.pdf", "linux")).not.toBe(
      attachmentPathKey("/vault/Rougier-2014.pdf", "linux"),
    );
  });

  it("meets a backslash-stored Zotero row and a forward-slash Obsidian path", () => {
    // Zotero writes a plain `linked_file` path with the platform's separators;
    // Obsidian collapses every separator run to `/` before it resolves one.
    expect(
      attachmentPathKey(
        "C:\\Users\\me\\Vault\\attachments\\rougier-2014.pdf",
        "win32",
      ),
    ).toBe(
      attachmentPathKey(
        "C:/Users/me/Vault/attachments/rougier-2014.pdf",
        "win32",
      ),
    );
  });
});
