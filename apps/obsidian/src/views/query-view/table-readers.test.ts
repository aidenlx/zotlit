import { TFile } from "@mock/obsidian";
import { describe, expect, it, vi } from "vitest";

import { defaults } from "@/services/settings/schema";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { tableReaders } from "./table-readers";
import type { TableReadersDeps } from "./table-readers";

vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));

/** Item ABCD2345 with a stored PDF, PDFA2345, and a stored EPUB, EPUB2345. */
const SEED = `
  insert into libraries (libraryID, type) values (1, 'user');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment');
  insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified)
    values (7, 1, 1, 'ABCD2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'),
      (20, 2, 1, 'PDFA2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'),
      (21, 2, 1, 'EPUB2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (20, 7, 0, 'application/pdf', 'storage:Doe 2024.pdf'),
      (21, 7, 0, 'application/epub+zip', 'storage:Doe 2024.epub');
`;

/** A workspace that records where each open landed, over the seeded database. */
function setup(stack: AsyncDisposableStack) {
  const file = new TFile();
  const openFile = vi.fn(async () => {});
  const getLeaf = vi.fn(() => ({ openFile }));
  const getFileByPath = vi.fn(() => file);
  const zotero = vi.fn();
  const deps = {
    app: {
      vault: { adapter: { getBasePath: () => "/vault" }, getFileByPath },
      workspace: { getLeaf },
    },
    reads: stack.use(inProcessReadsService(memoryOpener(() => SEED).open)),
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    settings: { current: defaults },
    openUri: zotero,
  } as unknown as TableReadersDeps;
  return {
    readers: tableReaders(deps),
    file,
    openFile,
    getLeaf,
    getFileByPath,
    zotero,
  };
}

describe("tableReaders", () => {
  it("opens a PDF Attachment in Obsidian's PDF view, in the pane asked for", async () => {
    await using stack = new AsyncDisposableStack();
    const { readers, file, openFile, getLeaf, getFileByPath, zotero } =
      setup(stack);
    await readers.open(
      { kind: "attachment", attachmentKey: "PDFA2345" },
      "tab",
    );
    expect(getFileByPath).toHaveBeenCalledWith(
      "file:/data/storage/PDFA2345/Doe 2024.pdf",
    );
    expect(getLeaf).toHaveBeenCalledWith("tab");
    expect(openFile).toHaveBeenCalledWith(file);
    expect(zotero).not.toHaveBeenCalled();
  });

  it("opens an Annotation of a PDF at its page, with its Annotation Anchor", async () => {
    await using stack = new AsyncDisposableStack();
    const { readers, file, openFile, getLeaf, zotero } = setup(stack);
    await readers.open(
      {
        kind: "annotation",
        attachmentKey: "PDFA2345",
        annotationKey: "HLTA2345",
        pageIndex: 2,
        pageLabel: "iii",
      },
      false,
    );
    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(openFile).toHaveBeenCalledWith(file, {
      eState: { subpath: "#page=3&zt-annotation=HLTA2345" },
    });
    expect(zotero).not.toHaveBeenCalled();
  });

  it("opens an Attachment Obsidian cannot host in Zotero's reader", async () => {
    await using stack = new AsyncDisposableStack();
    const { readers, getLeaf, zotero } = setup(stack);
    await readers.open(
      { kind: "attachment", attachmentKey: "EPUB2345" },
      "tab",
    );
    expect(zotero).toHaveBeenCalledWith("zotero://open/library/items/EPUB2345");
    expect(getLeaf).not.toHaveBeenCalled();
  });

  it("opens an Annotation Obsidian cannot host in Zotero's reader, at the Annotation", async () => {
    await using stack = new AsyncDisposableStack();
    const { readers, getLeaf, zotero } = setup(stack);
    await readers.open(
      {
        kind: "annotation",
        attachmentKey: "EPUB2345",
        annotationKey: "HLTA2345",
        pageIndex: null,
        pageLabel: "12",
      },
      false,
    );
    expect(zotero).toHaveBeenCalledWith(
      "zotero://open/library/items/EPUB2345?annotation=HLTA2345&page=12",
    );
    expect(getLeaf).not.toHaveBeenCalled();
  });

  it("opens nothing for an Attachment the database no longer has", async () => {
    await using stack = new AsyncDisposableStack();
    const { readers, getLeaf, zotero } = setup(stack);
    await readers.open(
      { kind: "attachment", attachmentKey: "GONE2345" },
      false,
    );
    expect(getLeaf).not.toHaveBeenCalled();
    expect(zotero).not.toHaveBeenCalled();
  });
});
