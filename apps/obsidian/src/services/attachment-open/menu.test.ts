import { Menu } from "@mock/obsidian";
import type { MenuItem as MockMenuItem } from "@mock/obsidian";
import type {
  App,
  FileSystemAdapter,
  Menu as ObsidianMenu,
  MenuItem,
  Vault,
  Workspace,
} from "obsidian";
import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { openAttachments } from "@/lib/attachment-open";
import { fileMenuHandler as handlerFor } from "@/services/__fixtures__/file-menu";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import type { AttachmentOpenDeps } from "./actions";
import { attachmentOpenFileMenu } from "./menu";
import type { TargetOpener } from "./open-target";
import { toObsidianOpenableAttachments } from "./resolve";
import type { ObsidianOpenableAttachment } from "./resolve";

vi.mock("./resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resolve")>()),
  toObsidianOpenableAttachments: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
}));

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

/** The mock menu behind the public Obsidian `Menu` type its consumer takes. */
function obsidianMenu(menu: Menu): ObsidianMenu {
  const typed = Object.assign(stubService<ObsidianMenu>("Menu", {}), {
    addItem(callback: (item: MenuItem) => unknown): ObsidianMenu {
      menu.addItem((item) => callback(obsidianMenuItem(item)));
      return typed;
    },
  });
  return typed;
}

/** The mock item behind the public Obsidian `MenuItem` type. */
function obsidianMenuItem(item: MockMenuItem): MenuItem {
  const typed = Object.assign(stubService<MenuItem>("MenuItem", {}), {
    setSection(section: string): MenuItem {
      item.setSection(section);
      return typed;
    },
    setTitle(title: string): MenuItem {
      item.setTitle(title);
      return typed;
    },
    setIcon(icon: string): MenuItem {
      item.setIcon(icon);
      return typed;
    },
    setDisabled(disabled: boolean): MenuItem {
      item.setDisabled(disabled);
      return typed;
    },
    onClick(
      callback: (event: MouseEvent | KeyboardEvent) => unknown,
    ): MenuItem {
      item.onClick(callback);
      return typed;
    },
  });
  return typed;
}

beforeEach(() => {
  stack = new AsyncDisposableStack();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
});

afterEach(() => stack.disposeAsync());

function fileMenuHandler(
  deps: Partial<AttachmentOpenDeps> = {},
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345" },
) {
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", {
      adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
        getBasePath: () => "/vault",
      }),
    }),
    workspace: stubService<Workspace>("Workspace", {
      trigger: () => {},
    }),
  });
  return handlerFor(
    [
      attachmentOpenFileMenu({
        app,
        reads: stack.use(
          inProcessReadsService(memoryOpener(() => ITEM_WITH_PDFS).open),
        ),
        zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
        opener: stubService<Pick<TargetOpener, "open">>("TargetOpener", {}),
        ...deps,
      }),
    ],
    frontmatter,
  );
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
  it("adds the Open PDF entry to the open section", () => {
    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");

    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]!.title).toBe("Open PDF");
    expect(menu.items[0]!.section).toBe("open");
  });

  it("opens the resolved Attachments on click", async () => {
    const openable: ObsidianOpenableAttachment[] = [
      {
        indexedKey: "ATCH1",
        label: "Alpha.pdf",
        openPath: "Alpha.pdf",
        absolutePath: "/vault/Alpha.pdf",
      },
    ];
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue(openable);

    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(openable, {
        reader: expect.anything(),
        host: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  it("stays off a note that carries no item key", () => {
    const menu = new Menu();
    fileMenuHandler({}, {})(obsidianMenu(menu), markdownFile(), "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("calls openAttachments with an empty list when the note has no PDF Attachment", async () => {
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);

    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        host: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  /**
   * `evt.currentTarget` is nulled once dispatch ends, which for an async
   * `onClick` happens at the very `await` this handler carries — before the
   * picker opens. The box is read before that gap and carried through it.
   * Exercises the real `openAttachments` (not the module-level mock) so the
   * regression is caught end to end.
   */
  it("shows the picker at the button's own box for a keyboard click, after the async database read", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/attachment-open")
    >("@/lib/attachment-open");
    vi.mocked(openAttachments).mockImplementation(actual.openAttachments);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      {
        indexedKey: "ATCH1",
        label: "Alpha.pdf",
        openPath: "Alpha.pdf",
        absolutePath: "/vault/Alpha.pdf",
      },
      {
        indexedKey: "ATCH2",
        label: "Beta.pdf",
        openPath: "Beta.pdf",
        absolutePath: "/vault/Beta.pdf",
      },
    ]);

    Menu.instances.length = 0;
    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");

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
