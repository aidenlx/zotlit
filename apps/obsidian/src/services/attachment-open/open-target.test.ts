import { describe, expect, it, vi } from "vitest";

import { FILES, openerHarness } from "./__fixtures__";
import type { OpenTarget } from "./open-target";

const ANNOTATION: OpenTarget = {
  kind: "annotation",
  attachmentKey: "RGRPDF24",
  annotationKey: "FDRFQ7C2",
  pageIndex: 1,
  pageLabel: "2",
};

describe("open", () => {
  it("opens an Obsidian-Openable Attachment in Obsidian's reader, in the pane asked for", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack);

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "PDFSTR22" }, "tab"),
    ).resolves.toEqual({ kind: "reader" });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "PDFSTR22",
          label: "sakimas song.pdf",
          openPath: `file:${FILES.stored}`,
          absolutePath: FILES.stored,
        },
        pane: "tab",
      },
    ]);
    expect(handed).toEqual([]);
  });

  it("opens an Annotation at its page, with its Annotation Anchor", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await opener.open(ANNOTATION, false);

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "RGRPDF24",
          label: "rougier-2014.pdf",
          openPath: "attachments/rougier-2014.pdf",
          absolutePath: FILES.rougier,
          subpath: "#page=2&zt-annotation=FDRFQ7C2",
        },
        pane: false,
      },
    ]);
  });

  // Two Attachments keep one file. The open names the one it was asked for,
  // not the one the path chooses, and the reader binds that one.
  it("opens the Attachment it was asked for where another keeps the same file", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, resolver } = await openerHarness(stack);
    expect(resolver.resolve(FILES.rougier)).toMatchObject({
      attachmentKey: "RGRPDF24",
    });

    await opener.open({ kind: "attachment", attachmentKey: "RGRCPYB8" }, false);

    expect(opened.map(({ attachment }) => attachment.indexedKey)).toEqual([
      "RGRCPYB8",
    ]);
  });

  it("hands an Attachment Obsidian cannot host to Zotero", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack);

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
    await using stack = new AsyncDisposableStack();
    const { opener, handed } = await openerHarness(stack);

    await opener.open(
      { ...ANNOTATION, attachmentKey: "EPUBSTR2", pageLabel: "iv" },
      false,
    );

    expect(handed).toEqual([
      "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2&page=iv",
    ]);
  });

  it("hands an Attachment that keeps no file Zotero knows of to Zotero", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack);

    await opener.open({ kind: "attachment", attachmentKey: "LINKURL2" }, false);

    expect(handed).toEqual(["zotero://open/library/items/LINKURL2"]);
    expect(opened).toEqual([]);
  });

  // A synced library on a second computer names a file that never arrived;
  // that computer reaches the Attachment through Zotero instead.
  it("hands the target to Zotero when the reader finds no file at the open", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack, {
      missing: [FILES.rougier],
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
    await using stack = new AsyncDisposableStack();
    const { opener, handed } = await openerHarness(stack);

    await opener.open(
      {
        kind: "annotation",
        attachmentKey: "GRPMISS9g4200309",
        annotationKey: "FDRFQ7C2g4200309",
        pageIndex: null,
        pageLabel: null,
      },
      false,
    );

    expect(handed).toEqual([
      "zotero://open/groups/4200309/items/GRPMISS9?annotation=FDRFQ7C2",
    ]);
  });

  // A card clicked while the index is still building waits for it, rather
  // than sending a PDF this computer holds to Zotero.
  it("waits for the first index before it decides", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed, resolver } = await openerHarness(stack, {
      prime: false,
    });
    expect(resolver.lookup("RGRPDF24")).toEqual({ kind: "pending" });

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "RGRPDF24" }, false),
    ).resolves.toEqual({ kind: "reader" });

    expect(opened).toHaveLength(1);
    expect(handed).toEqual([]);
  });

  // An index that never comes must not swallow the click: past the wait, the
  // target opens in Zotero, as it did while the index was pending. A database
  // read that fails leaves the index unbuilt the same way.
  it("opens in Zotero once the first index outlasts the wait", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed, failReads } = await openerHarness(stack, {
      prime: false,
    });
    failReads(true);
    vi.useFakeTimers();
    stack.defer(() => {
      vi.useRealTimers();
    });

    const outcome = opener.open(ANNOTATION, false);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(handed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toEqual({
      kind: "zotero",
      url: "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
    });
    expect(opened).toEqual([]);
    expect(handed).toHaveLength(1);
  });

  it("opens nothing for a key that is no Indexed Key", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack);

    await expect(
      opener.open({ kind: "attachment", attachmentKey: "not a key" }, false),
    ).resolves.toEqual({ kind: "unknown" });

    expect(opened).toEqual([]);
    expect(handed).toEqual([]);
  });
});

const STORED_LINK =
  "file:///fixture/zotero-data/storage/PDFSTR22/sakimas%20song.pdf";
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

describe("follow", () => {
  it.each([
    ["a web link", "https://example.com/paper.pdf"],
    ["a string that is no URL", "not a url"],
    [
      "a file Zotero does not know",
      "file:///fixture/vault/attachments/other.pdf",
    ],
    [
      "a file Obsidian cannot host",
      "file:///fixture/zotero-data/storage/EPUBSTR2/sakimas-song.epub",
    ],
    ["a link that names no Annotation", "zotero://open/library/items/RGRPDF24"],
    [
      "a link to an Attachment Zotero holds no file for",
      "zotero://open/library/items/LINKURL2?annotation=FDRFQ7C2",
    ],
    [
      "a link to an Attachment Obsidian cannot host",
      "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2",
    ],
  ])("leaves %s to the caller", async (_, url) => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened, handed } = await openerHarness(stack);

    expect(opener.follow(url, false)).toBeNull();

    expect(opened).toEqual([]);
    expect(handed).toEqual([]);
  });

  // Until the index lands ZotLit cannot name the file, and does not claim it.
  it("leaves every link to the caller while the index is building", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener } = await openerHarness(stack, { prime: false });

    expect(opener.follow(STORED_LINK, false)).toBeNull();
    expect(opener.follow(DURABLE, false)).toBeNull();
  });

  it("opens an Attachment File Link in Obsidian's reader at the page it names", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await expect(
      opener.follow(`${STORED_LINK}#page=7`, "split"),
    ).resolves.toEqual({ kind: "reader" });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "PDFSTR22",
          label: "sakimas song.pdf",
          openPath: `file:${FILES.stored}`,
          absolutePath: FILES.stored,
          subpath: "#page=7",
        },
        pane: "split",
      },
    ]);
  });

  it("opens an in-vault Attachment File Link by its vault-relative path", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await opener.follow(`file://${FILES.rougier}`, false);

    expect(opened[0]?.attachment).toMatchObject({
      indexedKey: "RGRPDF24",
      openPath: "attachments/rougier-2014.pdf",
    });
  });

  // An Attachment File Link names nothing Zotero can open in its stead, so
  // the caller says the file is missing.
  it("reports a missing file behind an Attachment File Link, and hands nothing to Zotero", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, handed } = await openerHarness(stack, {
      missing: [FILES.stored],
    });

    await expect(opener.follow(STORED_LINK, false)).resolves.toEqual({
      kind: "file-missing",
    });

    expect(handed).toEqual([]);
  });

  it("opens a Durable Annotation Link at the Annotation it names", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await expect(opener.follow(DURABLE, "tab")).resolves.toEqual({
      kind: "reader",
    });

    expect(opened).toEqual([
      {
        attachment: {
          indexedKey: "RGRPDF24",
          label: "rougier-2014.pdf",
          openPath: "attachments/rougier-2014.pdf",
          absolutePath: FILES.rougier,
          subpath: "#page=2&zt-annotation=FDRFQ7C2",
        },
        pane: "tab",
      },
    ]);
  });

  it("opens the Attachment a Durable Annotation Link names where another keeps the same file", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

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
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await opener.follow(
      "zotero://open/groups/4200309/items/RGRGRUP9?annotation=FDRFQ7C2&page=2",
      false,
    );

    expect(opened[0]?.attachment).toMatchObject({
      indexedKey: "RGRGRUP9g4200309",
      absolutePath: FILES.grouped,
      subpath: "#page=2&zt-annotation=FDRFQ7C2g4200309",
    });
  });

  // `page` is a printed label. Only a label that reads as a page number can
  // stand in for Obsidian's own jump; the Annotation's own page wins anyway.
  it("leaves out a page label that is no page number", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, opened } = await openerHarness(stack);

    await opener.follow(
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv",
      false,
    );

    expect(opened[0]?.attachment.subpath).toBe("#zt-annotation=FDRFQ7C2");
  });

  it("hands a Durable Annotation Link to Zotero as written when the reader finds no file", async () => {
    await using stack = new AsyncDisposableStack();
    const { opener, handed } = await openerHarness(stack, {
      missing: [FILES.rougier],
    });
    const link =
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv";

    await expect(opener.follow(link, false)).resolves.toEqual({
      kind: "zotero",
      url: link,
    });

    expect(handed).toEqual([link]);
  });
});
