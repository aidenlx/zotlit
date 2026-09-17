import { TFile } from "@mock/obsidian";
import type { Command } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attachment } from "@zotlit/db";
import {
  getAttachmentsByParents,
  getItemsByKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";

import {
  addAttachmentOpenActions,
  resolveLiteratureNoteAttachments,
} from "./actions";
import type { AttachmentOpenDeps, AttachmentOpenLookupDeps } from "./actions";

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  resolveIndexedKeyLibrary: vi.fn(),
  getItemsByKey: vi.fn(),
  getAttachmentsByParents: vi.fn(),
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
  vi.mocked(resolveIndexedKeyLibrary).mockReset();
  vi.mocked(getItemsByKey).mockReset();
  vi.mocked(getAttachmentsByParents).mockReset();
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockClear();
});

function lookupDeps(
  overrides: Partial<AttachmentOpenLookupDeps> = {},
): AttachmentOpenLookupDeps {
  return {
    app: { vault: { adapter: { getBasePath: () => "/vault" } } },
    db: { state: "ready", client: {} },
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    ...overrides,
  } as unknown as AttachmentOpenLookupDeps;
}

/** A live Zotero PDF Attachment row, as `getAttachmentsByParents` hands one over. */
function attachmentFixture(overrides: Partial<Attachment> = {}): Attachment {
  return {
    itemID: 20,
    libraryID: 1,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 7,
    path: "storage:Doe 2024.pdf",
    contentType: "application/pdf",
    linkMode: 0,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * `attachmentFixture()`'s Obsidian-Openable shape, hand-computed from
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
  it("answers no Attachments while the database is not ready", () => {
    const result = resolveLiteratureNoteAttachments(
      lookupDeps({ db: { state: "loading", client: {} } as never }),
      "ABCD2345",
    );
    expect(result).toStrictEqual([]);
    expect(resolveIndexedKeyLibrary).not.toHaveBeenCalled();
  });

  it("answers no Attachments when the Indexed Key names no Library", () => {
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue(null);
    const result = resolveLiteratureNoteAttachments(lookupDeps(), "bad-key");
    expect(result).toStrictEqual([]);
    expect(getItemsByKey).not.toHaveBeenCalled();
  });

  it("answers no Attachments when the key resolves to no live Item", () => {
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 1,
    });
    vi.mocked(getItemsByKey).mockReturnValue([]);
    const result = resolveLiteratureNoteAttachments(lookupDeps(), "ABCD2345");
    expect(result).toStrictEqual([]);
    expect(getAttachmentsByParents).not.toHaveBeenCalled();
  });

  it("resolves the Item's Attachments through the database once the itemID is known", () => {
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 1,
    });
    vi.mocked(getItemsByKey).mockReturnValue([{ itemID: 7 }] as never);
    vi.mocked(getAttachmentsByParents).mockReturnValue([attachmentFixture()]);

    const result = resolveLiteratureNoteAttachments(lookupDeps(), "ABCD2345");

    expect(getAttachmentsByParents).toHaveBeenCalledWith(
      expect.anything(),
      [7],
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
      ...lookupDeps(),
      app: { workspace: { getActiveFile: () => null } },
      db: { state: "ready", client: {}, ready: Promise.resolve() },
    } as unknown as AttachmentOpenDeps;
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    const deps = {
      ...lookupDeps(),
      app: {
        workspace: { getActiveFile: () => file },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      },
      db: { state: "ready", client: {}, ready: Promise.resolve() },
    } as unknown as AttachmentOpenDeps;
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("opens the resolved Attachments through the Suggest modal picker once run", async () => {
    const file = new TFile();
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: "ABCD2345",
      libraryID: 1,
    });
    vi.mocked(getItemsByKey).mockReturnValue([{ itemID: 7 }] as never);
    vi.mocked(getAttachmentsByParents).mockReturnValue([attachmentFixture()]);

    const app = {
      workspace: { getActiveFile: () => file },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { "zotero-key": "ABCD2345" } }),
      },
      vault: { adapter: { getBasePath: () => "/vault" } },
    };
    const deps = {
      app,
      db: { state: "ready", client: {}, ready: Promise.resolve() },
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
    const file = new TFile();
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue(null);

    const app = {
      workspace: { getActiveFile: () => file },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { "zotero-key": "ABCD2345" } }),
      },
      vault: { adapter: { getBasePath: () => "/vault" } },
    };
    const deps = {
      app,
      db: { state: "ready", client: {}, ready: Promise.resolve() },
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
