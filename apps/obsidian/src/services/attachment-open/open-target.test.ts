import { describe, expect, it } from "vitest";

import type {
  AttachmentLookup,
  AttachmentResolution,
} from "@/services/attachment-resolver/service";

import { createTargetOpener } from "./open-target";
import type { OpenTarget, ReaderOutcome } from "./open-target";
import type { ObsidianOpenableAttachment } from "./resolve";

const VAULT = "/Users/me/Vault";

/** One Attachment row the fake resolver knows, keyed as the real index keys it. */
interface Row {
  attachmentKey: string;
  itemKey: string | null;
  absolutePath: string;
  openable: boolean;
}

/** The Fixture's Rougier PDF: a linked file inside the vault. */
const ROUGIER: Row = {
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  absolutePath: `${VAULT}/attachments/rougier-2014.pdf`,
  openable: true,
};

/** A second Attachment of the same file, which the path does not choose. */
const ROUGIER_COPY: Row = {
  attachmentKey: "RGRCPYB8",
  itemKey: "RUGIERC8",
  absolutePath: ROUGIER.absolutePath,
  openable: true,
};

/** A Zotero-managed PDF outside the vault. */
const STORED: Row = {
  attachmentKey: "PDFSTR22",
  itemKey: "SAKIMA22",
  absolutePath: "/Users/me/Zotero/storage/PDFSTR22/sakimas song.pdf",
  openable: true,
};

/** A file Obsidian's PDF view cannot host. */
const EPUB: Row = {
  attachmentKey: "EPUBSTR2",
  itemKey: "SAKIMA22",
  absolutePath: "/Users/me/Zotero/storage/EPUBSTR2/sakimas-song.epub",
  openable: false,
};

/** A group-library Attachment, by its group's Indexed Key. */
const GROUPED: Row = {
  attachmentKey: "RGRGRUP9g4200309",
  itemKey: "RUGIERG9g4200309",
  absolutePath: "/Users/me/Zotero/storage/RGRGRUP9/shared.pdf",
  openable: true,
};

const ROWS = [ROUGIER, ROUGIER_COPY, STORED, EPUB, GROUPED];

/**
 * The Attachment resolver over `rows`, answering only what each lookup asks.
 * The first row of a file is the one its path chooses, as the real index ranks
 * a shared file; `pending` answers every lookup until `index()` lands.
 */
function attachments(rows: readonly Row[], { pending = false } = {}) {
  let indexed = !pending;
  const landed = Promise.withResolvers<void>();
  if (indexed) landed.resolve();
  const resolutionOf = (row: Row): AttachmentResolution => ({
    kind: "resolved",
    serverID: null,
    attachmentKey: row.attachmentKey,
    itemKey: row.itemKey,
    openable: row.openable,
  });
  return {
    resolve(
      absolutePath: string,
      { attachmentKey }: { attachmentKey?: string | null } = {},
    ): AttachmentResolution {
      if (!indexed) return { kind: "pending" };
      const named = rows.find(
        (row) =>
          row.attachmentKey === attachmentKey &&
          row.absolutePath === absolutePath,
      );
      const row =
        named ?? rows.find((row) => row.absolutePath === absolutePath);
      return row ? resolutionOf(row) : { kind: "unresolved" };
    },
    lookup(attachmentKey: string): AttachmentLookup {
      if (!indexed) return { kind: "pending" };
      const row = rows.find((row) => row.attachmentKey === attachmentKey);
      return row
        ? {
            ...(resolutionOf(row) as Extract<
              AttachmentResolution,
              { kind: "resolved" }
            >),
            absolutePath: row.absolutePath,
          }
        : { kind: "unresolved" };
    },
    warm() {},
    get indexed() {
      return landed.promise;
    },
    /** The first index lands. */
    index() {
      indexed = true;
      landed.resolve();
    },
  };
}

/**
 * The opener over a reader that records each open and finds no file at the
 * paths in `missing`, and a system handler that records each link.
 */
function setup({
  rows = ROWS,
  pending = false,
  missing = [] as readonly string[],
} = {}) {
  const opened: { attachment: ObsidianOpenableAttachment; pane: unknown }[] =
    [];
  const handed: string[] = [];
  const resolver = attachments(rows, { pending });
  const opener = createTargetOpener({
    attachments: resolver,
    reader: {
      open: (attachment, pane): Promise<ReaderOutcome> => {
        if (missing.includes(attachment.absolutePath))
          return Promise.resolve("file-missing");
        opened.push({ attachment, pane });
        return Promise.resolve("opened");
      },
    },
    native: (url) => void handed.push(url),
    vaultBasePath: VAULT,
    platform: "darwin",
  });
  return { opener, opened, handed, resolver };
}

const ANNOTATION: OpenTarget = {
  kind: "annotation",
  attachmentKey: "RGRPDF24",
  annotationKey: "FDRFQ7C2",
  pageIndex: 1,
  pageLabel: "2",
};

describe("open", () => {
  it("opens an Obsidian-Openable Attachment in Obsidian's reader, in the pane asked for", async () => {
    const { opener, opened, handed } = setup();

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "PDFSTR22" }, "tab"),
    ).resolves.toEqual({ kind: "reader" });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "PDFSTR22",
          label: "sakimas song.pdf",
          openPath: "file:/Users/me/Zotero/storage/PDFSTR22/sakimas song.pdf",
          absolutePath: STORED.absolutePath,
        },
        pane: "tab",
      },
    ]);
    expect(handed).toEqual([]);
  });

  it("opens an Annotation at its page, with its Annotation Anchor", async () => {
    const { opener, opened } = setup();

    await opener.open(ANNOTATION, false);

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "RGRPDF24",
          label: "rougier-2014.pdf",
          openPath: "attachments/rougier-2014.pdf",
          absolutePath: ROUGIER.absolutePath,
          subpath: "#page=2&zt-annotation=FDRFQ7C2",
        },
        pane: false,
      },
    ]);
  });

  // Two Attachments keep one file. The open names the one it was asked for,
  // not the one the path chooses, and the reader binds that one.
  it("opens the Attachment it was asked for where another keeps the same file", async () => {
    const { opener, opened } = setup();

    await opener.open({ kind: "attachment", attachmentKey: "RGRCPYB8" }, false);

    expect(opened.map(({ attachment }) => attachment.indexedKey)).toEqual([
      "RGRCPYB8",
    ]);
  });

  it("hands an Attachment Obsidian cannot host to Zotero", async () => {
    const { opener, opened, handed } = setup();

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "EPUBSTR2" }, "tab"),
    ).resolves.toEqual({
      kind: "zotero",
      url: "zotero://open/library/items/EPUBSTR2",
    });

    expect(handed).toEqual(["zotero://open/library/items/EPUBSTR2"]);
    expect(opened).toEqual([]);
  });

  it("hands an Annotation Obsidian cannot host to Zotero, at the Annotation", async () => {
    const { opener, handed } = setup();

    await opener.open(
      { ...ANNOTATION, attachmentKey: "EPUBSTR2", pageLabel: "iv" },
      false,
    );

    expect(handed).toEqual([
      "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2&page=iv",
    ]);
  });

  it("hands an Attachment that keeps no file Zotero knows of to Zotero", async () => {
    const { opener, opened, handed } = setup();

    await opener.open({ kind: "attachment", attachmentKey: "LINKURL2" }, false);

    expect(handed).toEqual(["zotero://open/library/items/LINKURL2"]);
    expect(opened).toEqual([]);
  });

  // A synced library on a second computer names a file that never arrived;
  // that computer reaches the Attachment through Zotero instead.
  it("hands the target to Zotero when the reader finds no file at the open", async () => {
    const { opener, opened, handed } = setup({
      missing: [ROUGIER.absolutePath],
    });

    await expect(opener.open(ANNOTATION, "tab")).resolves.toEqual({
      kind: "zotero",
      url: "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
    });

    expect(handed).toEqual([
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
    ]);
    expect(opened).toEqual([]);
  });

  it("names a group-library target to Zotero by its group", async () => {
    const { opener, handed } = setup({ rows: [] });

    await opener.open(
      {
        kind: "annotation",
        attachmentKey: "RGRGRUP9g4200309",
        annotationKey: "FDRFQ7C2g4200309",
        pageIndex: null,
        pageLabel: null,
      },
      false,
    );

    expect(handed).toEqual([
      "zotero://open/groups/4200309/items/RGRGRUP9?annotation=FDRFQ7C2",
    ]);
  });

  // A card clicked while the index is still building waits for it, rather
  // than sending a PDF this computer holds to Zotero.
  it("waits for the first index before it decides", async () => {
    const { opener, opened, handed, resolver } = setup({ pending: true });

    const outcome = opener.open(
      { kind: "attachment", attachmentKey: "RGRPDF24" },
      false,
    );
    resolver.index();

    await expect(outcome).resolves.toEqual({ kind: "reader" });
    expect(opened).toHaveLength(1);
    expect(handed).toEqual([]);
  });

  it("opens nothing for a key that is no Indexed Key", async () => {
    const { opener, opened, handed } = setup();

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "not a key" }, false),
    ).resolves.toEqual({ kind: "unknown" });

    expect(opened).toEqual([]);
    expect(handed).toEqual([]);
  });
});

const STORED_LINK =
  "file:///Users/me/Zotero/storage/PDFSTR22/sakimas%20song.pdf";
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

describe("follow", () => {
  it.each([
    ["a web link", "https://example.com/paper.pdf"],
    ["a string that is no URL", "not a url"],
    ["a file Zotero does not know", `file://${VAULT}/attachments/other.pdf`],
    [
      "a file Obsidian cannot host",
      "file:///Users/me/Zotero/storage/EPUBSTR2/sakimas-song.epub",
    ],
    ["a link that names no Annotation", "zotero://open/library/items/RGRPDF24"],
    [
      "a link with a malformed Annotation key",
      "zotero://open/library/items/RGRPDF24?annotation=FDRF",
    ],
    [
      "a link that selects rather than opens",
      "zotero://select/library/items/RGRPDF24?annotation=FDRFQ7C2",
    ],
    [
      "a link to an Attachment Zotero holds no file for",
      "zotero://open/library/items/LINKURL2?annotation=FDRFQ7C2",
    ],
    [
      "a link to an Attachment Obsidian cannot host",
      "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2",
    ],
  ])("leaves %s to the caller", (_, url) => {
    const { opener, opened, handed } = setup();

    expect(opener.follow(url, false)).toBeNull();

    expect(opened).toEqual([]);
    expect(handed).toEqual([]);
  });

  // Until the index lands ZotLit cannot name the file, and does not claim it.
  it("leaves every link to the caller while the index is building", () => {
    const { opener } = setup({ pending: true });

    expect(opener.follow(STORED_LINK, false)).toBeNull();
    expect(opener.follow(DURABLE, false)).toBeNull();
  });

  it("opens an Attachment File Link in Obsidian's reader at the page it names", async () => {
    const { opener, opened } = setup();

    await expect(
      opener.follow(`${STORED_LINK}#page=7`, "split"),
    ).resolves.toEqual({ kind: "reader" });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "PDFSTR22",
          label: "sakimas song.pdf",
          openPath: "file:/Users/me/Zotero/storage/PDFSTR22/sakimas song.pdf",
          absolutePath: STORED.absolutePath,
          subpath: "#page=7",
        },
        pane: "split",
      },
    ]);
  });

  it("opens an in-vault Attachment File Link by its vault-relative path", async () => {
    const { opener, opened } = setup();

    await opener.follow(`file://${ROUGIER.absolutePath}`, false);

    expect(opened[0]?.attachment.openPath).toBe("attachments/rougier-2014.pdf");
  });

  // An Attachment File Link names nothing Zotero can open in its stead, so
  // the caller says the file is missing.
  it("reports a missing file behind an Attachment File Link, and hands nothing to Zotero", async () => {
    const { opener, handed } = setup({ missing: [STORED.absolutePath] });

    await expect(opener.follow(STORED_LINK, false)).resolves.toEqual({
      kind: "file-missing",
    });

    expect(handed).toEqual([]);
  });

  it("opens a Durable Annotation Link at the Annotation it names", async () => {
    const { opener, opened } = setup();

    await expect(opener.follow(DURABLE, "tab")).resolves.toEqual({
      kind: "reader",
    });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "RGRPDF24",
          label: "rougier-2014.pdf",
          openPath: "attachments/rougier-2014.pdf",
          absolutePath: ROUGIER.absolutePath,
          subpath: "#page=2&zt-annotation=FDRFQ7C2",
        },
        pane: "tab",
      },
    ]);
  });

  it("opens the Attachment a Durable Annotation Link names where another keeps the same file", async () => {
    const { opener, opened } = setup();

    await opener.follow(
      "zotero://open/library/items/RGRCPYB8?annotation=FDRFQ7C2",
      false,
    );

    expect(opened.map(({ attachment }) => attachment.indexedKey)).toEqual([
      "RGRCPYB8",
    ]);
  });

  // The fragment carries no library segment of its own, so both keys travel
  // as Indexed Keys — the form an Annotation Record's key already takes.
  it("names a group-library Annotation by its Indexed Key", async () => {
    const { opener, opened } = setup();

    await opener.follow(
      "zotero://open/groups/4200309/items/RGRGRUP9?annotation=FDRFQ7C2&page=2",
      false,
    );

    expect(opened[0]?.attachment).toMatchObject({
      indexedKey: "RGRGRUP9g4200309",
      subpath: "#page=2&zt-annotation=FDRFQ7C2g4200309",
    });
  });

  // `page` is a printed label. Only a label that reads as a page number can
  // stand in for Obsidian's own jump; the Annotation's own page wins anyway.
  it("leaves out a page label that is no page number", async () => {
    const { opener, opened } = setup();

    await opener.follow(
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv",
      false,
    );

    expect(opened[0]?.attachment.subpath).toBe("#zt-annotation=FDRFQ7C2");
  });

  it("hands a Durable Annotation Link to Zotero as written when the reader finds no file", async () => {
    const { opener, handed } = setup({ missing: [ROUGIER.absolutePath] });
    const link =
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv";

    await expect(opener.follow(link, false)).resolves.toEqual({
      kind: "zotero",
      url: link,
    });

    expect(handed).toEqual([link]);
  });
});
