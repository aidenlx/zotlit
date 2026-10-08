import { Menu, TFile, TFolder } from "@mock/obsidian";
import type { TAbstractFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import type { AttachmentOpenDeps } from "./actions";
import { registerAttachmentOpenFileMenu } from "./menu";
import { toObsidianOpenableAttachments } from "./resolve";

vi.mock("./resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resolve")>()),
  toObsidianOpenableAttachments: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
  createObsidianAttachmentReader: vi.fn(() => ({
    icon: "file-text",
    open: vi.fn(),
  })),
}));

type FileMenuHandler = (
  menu: Menu,
  file: TAbstractFile,
  source: string,
) => void;

/** Item ABCD2345 with two stored PDFs. */
const ITEM_WITH_PDFS = `
  insert into libraries (libraryID, type) values (1, 'user');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment');
  insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified)
    values (7, 1, 1, 'ABCD2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (20, 2, 1, 'ATCHA234', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (21, 2, 1, 'ATCHB234', '2024-01-01 00:00:00', '2024-01-01 00:00:00');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (20, 7, 0, 'application/pdf', 'storage:Alpha.pdf'),
      (21, 7, 0, 'application/pdf', 'storage:Beta.pdf');
`;

let stack: AsyncDisposableStack;

beforeEach(() => {
  stack = new AsyncDisposableStack();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockImplementation(() => ({
    icon: "file-text",
    open: vi.fn(),
  }));
});

afterEach(() => stack.disposeAsync());

function fileMenuHandler(
  deps: Partial<AttachmentOpenDeps> = {},
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345" },
): FileMenuHandler {
  let handler: FileMenuHandler | undefined;
  const app = {
    workspace: {
      on: (name: string, cb: FileMenuHandler) => {
        if (name === "file-menu") handler = cb;
        return {};
      },
    },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    vault: { adapter: { getBasePath: () => "/vault" } },
  };
  registerAttachmentOpenFileMenu(
    { registerEvent: () => {}, app: app as never },
    {
      app,
      reads: stack.use(
        inProcessReadsService(memoryOpener(() => ITEM_WITH_PDFS).open),
      ),
      zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
      ...deps,
    } as unknown as AttachmentOpenDeps,
  );
  if (!handler) throw new Error("file-menu handler was not registered");
  return handler;
}

function markdownFile(): TFile {
  const file = new TFile();
  file.extension = "md";
  return file;
}

/** A rendered bounding rect a keyboard-driven click's `currentTarget` answers with. */
function anchorRect(): DOMRect {
  return {
    x: 10,
    y: 0,
    left: 10,
    width: 100,
    height: 20,
    bottom: 20,
  } as DOMRect;
}

describe("Literature Note attachment-open file menu", () => {
  it("adds the Open PDF entry to the zotlit section", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]!.title).toBe("Open PDF");
    expect(menu.items[0]!.section).toBe("zotlit");
  });

  it("opens the resolved Attachments on click", async () => {
    const openable = [{ indexedKey: "ATCH1" }];
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue(openable as never);

    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(openable, {
        reader: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  it("stays off a multi-file selection", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "files-menu");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a non-Markdown file", () => {
    const menu = new Menu();
    const file = new TFile();
    file.extension = "canvas";
    fileMenuHandler()(menu, file as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a folder", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, new TFolder() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a note that carries no item key", () => {
    const menu = new Menu();
    fileMenuHandler({}, {})(menu, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("calls openAttachments with an empty list when the note has no PDF Attachment", async () => {
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);

    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  /**
   * `evt.currentTarget` is nulled once dispatch ends, which for an async
   * `onClick` happens at the very `await` this handler carries — before the
   * picker opens. The box is read before that gap and carried through it.
   * Exercises the real `openAttachments` / `createObsidianAttachmentReader`
   * pair (not the module-level mocks) so the regression is caught end to end.
   */
  it("shows the picker at the button's own box for a keyboard click, after the async database read", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/attachment-open")
    >("@/lib/attachment-open");
    vi.mocked(openAttachments).mockImplementation(actual.openAttachments);
    vi.mocked(createObsidianAttachmentReader).mockImplementation(
      actual.createObsidianAttachmentReader,
    );
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      { indexedKey: "ATCH1", label: "Alpha.pdf" },
      { indexedKey: "ATCH2", label: "Beta.pdf" },
    ] as never);

    Menu.instances.length = 0;
    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "more-options");

    const rect = anchorRect();
    const evt = {
      detail: 0,
      currentTarget: { getBoundingClientRect: () => rect },
    } as unknown as MouseEvent;
    expect(() => menu.items[0]!.click(evt)).not.toThrow();
    // Dispatch has ended by the time the `await` above resumes — simulated
    // here by nulling `currentTarget` the instant the synchronous part of the
    // click handler returns.
    (evt as unknown as { currentTarget: unknown }).currentTarget = null;

    await vi.waitFor(() => expect(Menu.instances).toHaveLength(2));
    expect(Menu.instances[1]!.position).toStrictEqual({
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: false,
    });
  });
});
