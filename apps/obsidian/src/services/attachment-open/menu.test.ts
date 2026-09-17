import { Menu, TFile, TFolder } from "@mock/obsidian";
import type { TAbstractFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAttachmentsByParents,
  getItemsByKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";

import type { AttachmentOpenDeps } from "./actions";
import { registerAttachmentOpenFileMenu } from "./menu";
import { toObsidianOpenableAttachments } from "./resolve";

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  resolveIndexedKeyLibrary: vi.fn(),
  getItemsByKey: vi.fn(),
  getAttachmentsByParents: vi.fn(),
}));

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

beforeEach(() => {
  vi.mocked(resolveIndexedKeyLibrary).mockReset();
  vi.mocked(getItemsByKey).mockReset();
  vi.mocked(getAttachmentsByParents).mockReset();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockImplementation(() => ({
    icon: "file-text",
    open: vi.fn(),
  }));
});

function fileMenuHandler(
  deps: Partial<AttachmentOpenDeps> = {},
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345g42" },
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
      db: { state: "ready", client: {}, ready: Promise.resolve() },
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
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 42,
    });
    vi.mocked(getItemsByKey).mockReturnValue([{ itemID: 7 }] as never);
    vi.mocked(getAttachmentsByParents).mockReturnValue([{}] as never);
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
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 42,
    });
    vi.mocked(getItemsByKey).mockReturnValue([{ itemID: 7 }] as never);
    vi.mocked(getAttachmentsByParents).mockReturnValue([{}] as never);
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
  it("shows the picker at the button's own box for a keyboard click, after the async db.ready gap", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/attachment-open")
    >("@/lib/attachment-open");
    vi.mocked(openAttachments).mockImplementation(actual.openAttachments);
    vi.mocked(createObsidianAttachmentReader).mockImplementation(
      actual.createObsidianAttachmentReader,
    );
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 42,
    });
    vi.mocked(getItemsByKey).mockReturnValue([{ itemID: 7 }] as never);
    vi.mocked(getAttachmentsByParents).mockReturnValue([{}, {}] as never);
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
