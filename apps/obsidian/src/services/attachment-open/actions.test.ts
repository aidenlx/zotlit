import { TFile } from "@mock/obsidian";
import type { Command } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import { defaults } from "@/services/settings/schema";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";
import { activateAnnotView } from "@/views/annot-view/register";

import {
  addAttachmentOpenActions,
  createPdfReader,
  resolveLiteratureNoteAttachments,
} from "./actions";
import type { AttachmentOpenDeps, AttachmentOpenLookupDeps } from "./actions";

vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
  createObsidianAttachmentReader: vi.fn(() => ({
    icon: "file-text",
    open: vi.fn(),
  })),
}));

beforeEach(() => {
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockClear();
  vi.mocked(activateAnnotView).mockClear();
});

/** Item ABCD2345 (itemID 7) with one stored PDF, ATCH2345. */
const ITEM_WITH_PDF = `
  insert into libraries (libraryID, type) values (1, 'user');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment');
  insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified)
    values (7, 1, 1, 'ABCD2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (20, 2, 1, 'ATCH2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (8, 1, 1, 'NOPDF234', '2024-01-01 00:00:00', '2024-01-01 00:00:00');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (20, 7, 0, 'application/pdf', 'storage:Doe 2024.pdf');
`;

/** ZoteroReads over {@link ITEM_WITH_PDF}; `null` gives a database that cannot open. */
function readsOver(
  stack: AsyncDisposableStack,
  seed: string | null = ITEM_WITH_PDF,
): ZoteroReadsService {
  return stack.use(inProcessReadsService(memoryOpener(() => seed).open));
}

function lookupDeps(
  reads: Pick<ZoteroReadsService, "acquireRead">,
  overrides: Partial<AttachmentOpenLookupDeps> = {},
): AttachmentOpenLookupDeps {
  return {
    app: { vault: { adapter: { getBasePath: () => "/vault" } } },
    reads,
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    settings: { current: defaults },
    ...overrides,
  } as unknown as AttachmentOpenLookupDeps;
}

/**
 * {@link ITEM_WITH_PDF}'s Obsidian-Openable shape, hand-computed from
 * `lookupDeps()`'s `zoteroPref.dataDir` ("/data") and `app`'s vault base
 * ("/vault") — an independent oracle, not a call into the mapper under test.
 */
const OPENABLE_FIXTURE = [
  {
    indexedKey: "ATCH2345",
    label: "Doe 2024.pdf",
    openPath: "file:/data/storage/ATCH2345/Doe 2024.pdf",
    absolutePath: "/data/storage/ATCH2345/Doe 2024.pdf",
  },
];

describe("resolveLiteratureNoteAttachments", () => {
  it("answers no Attachments while the database cannot be read", async () => {
    await using stack = new AsyncDisposableStack();
    const result = await resolveLiteratureNoteAttachments(
      lookupDeps(readsOver(stack, null)),
      "ABCD2345",
    );
    expect(result).toStrictEqual([]);
  });

  it("answers no Attachments when the Indexed Key names no Library", async () => {
    await using stack = new AsyncDisposableStack();
    const result = await resolveLiteratureNoteAttachments(
      lookupDeps(readsOver(stack)),
      "ABCD2345g999",
    );
    expect(result).toStrictEqual([]);
  });

  it("answers no Attachments when the key resolves to no live Item", async () => {
    await using stack = new AsyncDisposableStack();
    const result = await resolveLiteratureNoteAttachments(
      lookupDeps(readsOver(stack)),
      "ZZZZ2345",
    );
    expect(result).toStrictEqual([]);
  });

  it("answers no Attachments for an Item that holds none", async () => {
    await using stack = new AsyncDisposableStack();
    const result = await resolveLiteratureNoteAttachments(
      lookupDeps(readsOver(stack)),
      "NOPDF234",
    );
    expect(result).toStrictEqual([]);
  });

  it("resolves the Item's Attachments through the database", async () => {
    await using stack = new AsyncDisposableStack();
    const result = await resolveLiteratureNoteAttachments(
      lookupDeps(readsOver(stack)),
      "ABCD2345",
    );
    expect(result).toStrictEqual(OPENABLE_FIXTURE);
  });
});

describe("open-pdf command", () => {
  function register(deps: AttachmentOpenDeps): Command {
    let command: Command | undefined;
    addAttachmentOpenActions(
      {
        addCommand(value) {
          command = value;
          return value;
        },
      },
      deps,
    );
    if (!command) throw new Error("Command was not registered");
    return command;
  }

  it("is unavailable without an active file", () => {
    const deps = {
      ...lookupDeps({ ready: new Promise(() => {}) } as never),
      app: { workspace: { getActiveFile: () => null } },
    } as unknown as AttachmentOpenDeps;
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    const deps = {
      ...lookupDeps({ ready: new Promise(() => {}) } as never),
      app: {
        workspace: { getActiveFile: () => file },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      },
    } as unknown as AttachmentOpenDeps;
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("opens the resolved Attachments through the Suggest modal picker once run", async () => {
    await using stack = new AsyncDisposableStack();
    const file = new TFile();

    const app = {
      workspace: { getActiveFile: () => file },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { "zotero-key": "ABCD2345" } }),
      },
      vault: { adapter: { getBasePath: () => "/vault" } },
    };
    const deps = {
      app,
      reads: readsOver(stack),
      zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    } as unknown as AttachmentOpenDeps;

    const command = register(deps);
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(
        OPENABLE_FIXTURE,
        {
          reader: expect.anything(),
          app,
        },
      ),
    );
  });

  it("calls openAttachments with an empty list when nothing resolves, deferring the notice to the reader", async () => {
    await using stack = new AsyncDisposableStack();
    const file = new TFile();

    const app = {
      workspace: { getActiveFile: () => file },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { "zotero-key": "ZZZZ2345" } }),
      },
      vault: { adapter: { getBasePath: () => "/vault" } },
    };
    const deps = {
      app,
      reads: readsOver(stack),
      zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    } as unknown as AttachmentOpenDeps;

    const command = register(deps);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        app,
      }),
    );
  });
});

describe("createPdfReader", () => {
  /** The hook the reader hands back to its caller once a file is on screen. */
  function onOpenedOf(deps: AttachmentOpenLookupDeps): () => void {
    createPdfReader(deps);
    const [, options] = vi.mocked(createObsidianAttachmentReader).mock
      .calls[0]!;
    const onOpened = options?.onOpened;
    if (!onOpened) throw new Error("the reader was built with no onOpened");
    return onOpened;
  }

  it("brings the annotation view forward beside the PDF by default", () => {
    const deps = lookupDeps({ ready: new Promise(() => {}) } as never);

    onOpenedOf(deps)();

    expect(activateAnnotView).toHaveBeenCalledWith(deps.app);
  });

  it("leaves the sidebar alone once the user turns the reveal off", () => {
    onOpenedOf(
      lookupDeps(
        { ready: new Promise(() => {}) } as never,
        {
          settings: {
            current: { ...defaults, "reader.focus-annot-view": false },
          },
        } as unknown as Partial<AttachmentOpenLookupDeps>,
      ),
    )();

    expect(activateAnnotView).not.toHaveBeenCalled();
  });

  it("reveals for a settings service that has not loaded yet, matching the default", () => {
    onOpenedOf(
      lookupDeps(
        { ready: new Promise(() => {}) } as never,
        {
          settings: { current: null },
        } as unknown as Partial<AttachmentOpenLookupDeps>,
      ),
    )();

    expect(activateAnnotView).toHaveBeenCalledOnce();
  });
});
