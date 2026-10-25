import { Effect } from "effect";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  Command,
  FileSystemAdapter,
  MetadataCache,
  Vault,
  Workspace,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import { defaults } from "@/services/settings/schema";
import type { TestReads } from "@/services/zotero-reads/__fixtures__";
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
import type { AttachmentOpenDeps, PdfReaderDeps } from "./actions";
import type { TargetOpener } from "./open-target";

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
): TestReads {
  return stack.use(inProcessReadsService(memoryOpener(() => seed).open));
}

/**
 * An App over a vault at /vault, whose workspace has `active` open and whose
 * metadata cache answers `cache` for it.
 */
function appWith(
  active: TFile | null = null,
  cache: CachedMetadata | null = null,
): App {
  return stubService<App>("App", {
    vault: stubService<Vault>("Vault", {
      adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
        getBasePath: () => "/vault",
      }),
    }),
    workspace: stubService<Workspace>("Workspace", {
      getActiveFile: () => active,
    }),
    metadataCache: stubService<MetadataCache>("MetadataCache", {
      getFileCache: () => cache,
    }),
  });
}

/** Reads a case leaves unread: reading one throws. */
const unreadReads = stubService<Pick<TestReads, "acquireRead">>(
  "ZoteroReads",
  {},
);

/** An opener a case leaves unused: the picker it builds is mocked. */
const unusedOpener = stubService<Pick<TargetOpener, "open">>(
  "TargetOpener",
  {},
);

function lookupDeps(
  reads: Pick<TestReads, "acquireRead">,
  overrides: Partial<AttachmentOpenDeps & PdfReaderDeps> = {},
): AttachmentOpenDeps & PdfReaderDeps {
  return {
    app: appWith(),
    reads,
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    settings: { current: Effect.succeed(defaults) },
    bridge: { runSync: Effect.runSync },
    opener: unusedOpener,
    ...overrides,
  };
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
    const deps = lookupDeps(unreadReads);
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    const deps = lookupDeps(unreadReads, {
      app: appWith(file, { frontmatter: {} }),
    });
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("opens the resolved Attachments through the Suggest modal picker once run", async () => {
    await using stack = new AsyncDisposableStack();
    const file = new TFile();

    const app = appWith(file, { frontmatter: { "zotero-key": "ABCD2345" } });
    const deps = lookupDeps(readsOver(stack), { app });

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

    const app = appWith(file, { frontmatter: { "zotero-key": "ZZZZ2345" } });
    const deps = lookupDeps(readsOver(stack), { app });

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
  function onOpenedOf(deps: PdfReaderDeps): () => void {
    createPdfReader(deps);
    const [, options] = vi.mocked(createObsidianAttachmentReader).mock
      .calls[0]!;
    const onOpened = options?.onOpened;
    if (!onOpened) throw new Error("the reader was built with no onOpened");
    return onOpened;
  }

  it("brings the annotation view forward beside the PDF by default", () => {
    const deps = lookupDeps(unreadReads);

    onOpenedOf(deps)();

    expect(activateAnnotView).toHaveBeenCalledWith(deps.app);
  });

  it("leaves the sidebar alone once the user turns the reveal off", () => {
    onOpenedOf(
      lookupDeps(unreadReads, {
        settings: {
          current: Effect.succeed({
            ...defaults,
            "reader.focus-annot-view": false,
          }),
        },
      }),
    )();

    expect(activateAnnotView).not.toHaveBeenCalled();
  });
});
