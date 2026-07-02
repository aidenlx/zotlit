import { TFile, TFolder, type App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatIndexedKey, getNoteByKey, USER_LIBRARY_ID } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { defaults, type Settings } from "@/services/settings/schema";

import {
  NoteImportMintError,
  NoteImportService,
  type PrepareNoteImportOptions,
} from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return { ...actual, getNoteByKey: vi.fn() };
});

vi.mock("./note-parser", () => ({
  parseNote: (_td: unknown, html: string) => `md(${html})`,
}));

// `prepare` builds the shared parser from the Obsidian `TurndownService` global;
// stub it so the bare reference resolves.
vi.stubGlobal("TurndownService", class {});

function makeFile(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype) as TFile, { path });
}

function makeNote(overrides: Partial<ReturnType<typeof baseNote>> = {}) {
  const base = baseNote({
    key: overrides.key,
    groupID: overrides.groupID,
  });
  return { ...base, ...overrides };
}

function baseNote(overrides?: { key?: string; groupID?: number | null }) {
  const key = overrides?.key ?? "NOTE1234";
  const groupID = overrides?.groupID ?? null;
  return {
    itemID: 50,
    libraryID: USER_LIBRARY_ID,
    groupID,
    parentItemID: 1,
    key,
    indexedKey: formatIndexedKey(key, groupID),
    title: "Methods",
    note: "<h1>Methods</h1><p>body</p>",
    dateAdded: Temporal.Instant.from("2024-01-01T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-02-03T08:30:00Z"),
  };
}

interface AppStub {
  app: App;
  create: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
}

function makeApp(): AppStub {
  const create = vi.fn(async (path: string) => makeFile(path));
  const createFolder = vi.fn(async (path: string) => {
    const folder = new TFolder();
    folder.path = path;
    return folder;
  });
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      getRoot: () => new TFolder(),
      create,
      createFolder,
    },
    fileManager: {
      // Mirrors Obsidian's (file, sourcePath, subpath, alias) signature.
      generateMarkdownLink: (...args: unknown[]) => {
        const file = args[0] as TFile;
        const alias = args[3] as string | undefined;
        return `[[${file.path}|${alias ?? ""}]]`;
      },
    },
  } as unknown as App;
  return { app, create, createFolder };
}

/** Per-note attachment batch stub; `flush` records whether copies were committed. */
function makeAttachmentImport() {
  const flush = vi.fn(async () => ({ copied: 0, skipped: 0, missing: 0 }));
  const resolveLink = vi.fn(() => () => "[[image.png]]");
  const prepare = vi.fn(async () => ({ resolveLink, flush }));
  return { prepare, flush, resolveLink };
}

function makeService(
  app: App,
  options: {
    existing?: TFile[];
    attachmentImport?: ReturnType<typeof makeAttachmentImport>;
  } = {},
): NoteImportService {
  const noteIndex = {
    getImportedNoteByNoteKey: () => options.existing ?? [],
  };
  const template = { render: vi.fn(() => "[@cite]") };
  const zoteroPref = { dataDir: "/data", baseAttachmentPath: null };
  return new NoteImportService({
    app,
    noteIndex: noteIndex as any,
    template: template as any,
    zoteroPref: zoteroPref as any,
    attachmentImport: (options.attachmentImport ??
      makeAttachmentImport()) as any,
  });
}

function makePrepare(
  overrides: Omit<Partial<PrepareNoteImportOptions>, "settings"> & {
    settings?: Partial<Settings>;
  } = {},
): PrepareNoteImportOptions {
  const { settings: settingsOverrides, ...rest } = overrides;
  return {
    client: {} as any,
    sourcePath: "Literature/Paper.md",
    groupID: null,
    libraryID: 1,
    settings: {
      ...defaults,
      "note.import-folder": "Imported",
      ...settingsOverrides,
    },
    ...rest,
  };
}

const PREPARE = makePrepare();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNoteByKey).mockReturnValue(makeNote());
});

describe("NoteImportService", () => {
  it("mints a flat path, renders the title alias, and creates the mirror on flush", async () => {
    const { app, create, createFolder } = makeApp();
    const attachmentImport = makeAttachmentImport();
    const batch = await makeService(app, { attachmentImport }).prepare(PREPARE);

    const link = batch.resolveChildNote({
      itemID: 50,
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      parentItemID: 1,
      key: "NOTE1234",
      indexedKey: "NOTE1234",
      title: "Methods",
      dateModified: Temporal.Instant.from("2024-02-03T08:30:00Z"),
    });
    const rendered = link.noteLink();
    expect(rendered).toMatch(
      /^\[\[Imported\/Methods_[\w-]{6}\.md\|Methods\]\]$/,
    );

    await expect(batch.flush()).resolves.toEqual({
      created: 1,
      skipped: 0,
      failed: 0,
    });
    expect(createFolder).toHaveBeenCalledExactlyOnceWith("Imported");
    const [path, content] = create.mock.calls[0]!;
    expect(path).toMatch(/^Imported\/Methods_[\w-]{6}\.md$/);
    expect(content).toContain("zotero-note-key: NOTE1234");
    expect(content).toMatch(
      /\ndate: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\n/,
    );
    expect(content).toContain("md(<h1>Methods</h1><p>body</p>)");
    // A written note commits its queued image copies.
    expect(attachmentImport.flush).toHaveBeenCalledOnce();
  });

  it("mints a bare root-relative path when the import folder is the vault root", async () => {
    const { app, create, createFolder } = makeApp();
    const batch = await makeService(app).prepare(
      makePrepare({ settings: { "note.import-folder": "" } }),
    );

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();
    expect(create.mock.calls[0]![0]).toMatch(/^Methods_[\w-]{6}\.md$/);
    // Root needs no folder creation.
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("scopes the identity key by groupID", async () => {
    vi.mocked(getNoteByKey).mockReturnValue(makeNote({ groupID: 42 }));
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare({ ...PREPARE, groupID: 42 });

    const link = batch.resolveChildNote(makeNote({ groupID: 42 }));
    link.noteLink();
    await batch.flush();
    expect(create.mock.calls[0]![1]).toContain("zotero-note-key: NOTE1234g42");
  });

  it("links to an existing imported note by identity, queuing nothing", async () => {
    const existing = makeFile("Imported/Old name_abc123.md");
    const { app, create } = makeApp();
    const batch = await makeService(app, { existing: [existing] }).prepare(
      PREPARE,
    );

    const link = batch.resolveChildNote(makeNote({ title: "Renamed" }));
    // The file is never renamed; only the alias reflects the new title.
    expect(link.noteLink()).toBe("[[Imported/Old name_abc123.md|Renamed]]");
    await expect(batch.flush()).resolves.toEqual({
      created: 0,
      skipped: 0,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("queues nothing when the link is never rendered", async () => {
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote());
    await expect(batch.flush()).resolves.toEqual({
      created: 0,
      skipped: 0,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("skips and warns when the note vanished before flush", async () => {
    vi.mocked(getNoteByKey).mockReturnValue(null);
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote()).noteLink();
    await expect(batch.flush()).resolves.toEqual({
      created: 0,
      skipped: 1,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("skips on a file-exists collision at write time without flushing copies", async () => {
    const { app, create } = makeApp();
    create.mockRejectedValueOnce(new Error("File already exists."));
    const attachmentImport = makeAttachmentImport();
    const batch = await makeService(app, { attachmentImport }).prepare(PREPARE);

    batch.resolveChildNote(makeNote()).noteLink();
    await expect(batch.flush()).resolves.toEqual({
      created: 0,
      skipped: 1,
      failed: 0,
    });
    // The note wasn't written, so its queued image copies stay inert.
    expect(attachmentImport.flush).not.toHaveBeenCalled();
  });

  it("isolates a note's hard write error so siblings still import", async () => {
    const { app, create } = makeApp();
    // A non-file-exists failure (disk full, permission, parse error) on one note.
    create.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote({ key: "NOTE0001" })).noteLink();
    batch.resolveChildNote(makeNote({ key: "NOTE0002" })).noteLink();

    await expect(batch.flush()).resolves.toEqual({
      created: 1,
      skipped: 0,
      failed: 1,
    });
    // Both notes were attempted; the failure didn't short-circuit the sibling.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws NoteImportMintError when the minted path is already occupied", async () => {
    const { app } = makeApp();
    // Any path the mint checks reports as occupied, forcing the hard collision.
    app.vault.getAbstractFileByPath = () => makeFile("occupied.md");
    const batch = await makeService(app).prepare(PREPARE);

    expect(() => batch.resolveChildNote(makeNote())).toThrow(
      NoteImportMintError,
    );
  });

  it("falls back to a key-based name when the title sanitizes to empty", async () => {
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote({ title: "..." })).noteLink();
    await batch.flush();
    expect(create.mock.calls[0]![0]).toMatch(
      /^Imported\/zotero_note_NOTE1234_[\w-]{6}\.md$/,
    );
  });
});
