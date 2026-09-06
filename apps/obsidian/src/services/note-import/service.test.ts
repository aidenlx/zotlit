import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatIndexedKey,
  getAnnotationsByKey,
  getNoteByKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";

import { renderAnnotations } from "@/lib/annotation-render";
import { AttachmentImportService } from "@/services/attachment-import/service";
import type {
  AttachmentSource,
  SourceOrigin,
} from "@/services/attachment-import/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";

import { parseNote } from "./note-parser";
import { createNoteImporter, NoteImportMintError } from "./service";
import type {
  ImportVaultApp,
  NoteImporter,
  PrepareNoteImportOptions,
} from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return { ...actual, getNoteByKey: vi.fn(), getAnnotationsByKey: vi.fn() };
});

// The service owns the annotation renderer now; stub the leaf so the test asserts
// the wiring (resolveLink binding, library scoping) without the DB template pipeline.
vi.mock("@/lib/annotation-render", () => ({
  renderAnnotations: vi.fn(() => new Map<string, string>()),
}));

// `parseNote` is stubbed to echo its HTML and any annotation-callout output, so
// the service-built `renderAnnotationParagraph` is exercised through the write.
vi.mock("./note-parser", () => ({
  parseNote: vi.fn(
    (
      _td: unknown,
      html: string,
      deps: {
        renderAnnotationParagraph?: (
          keys: readonly string[],
        ) => ReadonlyMap<string, string>;
      },
    ) => {
      const callouts = deps.renderAnnotationParagraph
        ? [...deps.renderAnnotationParagraph(["ANNOT1"]).values()]
        : [];
      return callouts.length > 0
        ? `md(${html})\n${callouts.join("\n")}`
        : `md(${html})`;
    },
  ),
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
  app: ImportVaultApp;
  create: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
}

function makeApp(): AppStub {
  const create = vi.fn(async (path: string) => makeFile(path));
  const createFolder = vi.fn(async (path: string) => {
    const folder = new TFolder();
    folder.path = path;
    return folder;
  });
  const process = vi.fn(async (_file: TFile, fn: (data: string) => string) => {
    return fn("");
  });
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      getFileByPath: (path: string) => makeFile(path),
      getRoot: () => new TFolder(),
      create,
      createFolder,
      process,
    },
    fileManager: {
      // Mirrors Obsidian's (file, sourcePath, subpath, alias) signature.
      generateMarkdownLink: (...args: unknown[]) => {
        const file = args[0] as TFile;
        const alias = args[3] as string | undefined;
        return `[[${file.path}|${alias ?? ""}]]`;
      },
    },
  };
  return { app, create, createFolder, process };
}

/** Per-note attachment batch stub; `flush` records whether copies were committed. */
function makeAttachmentImport() {
  const flush = vi.fn(async () => ({
    copied: 0,
    skipped: 0,
    missing: 0,
    blocked: 0,
    refused: 0,
  }));
  const decide = vi.fn(
    (path: string, origin: SourceOrigin): AttachmentSource => ({
      approved: false,
      path,
      origin,
      reason: "no-trusted-root",
    }),
  );
  const resolveLink = vi.fn(() => () => "[[image.png]]");
  const discard = vi.fn();
  const prepare = vi.fn(async () => ({ decide, resolveLink, flush, discard }));
  return { prepare, flush, decide, resolveLink };
}

/**
 * The real decision service over a Zotero data directory that does not resolve
 * and no approved folder, so every source it judges blocks. Lets a test observe
 * the `file://` fallback the production seam renders, rather than a stub's.
 */
function makeBlockingAttachmentImport(): AttachmentImportService {
  return new AttachmentImportService({
    app: {
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
    } as unknown as App,
    settings: {
      loaded: Promise.resolve({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }),
      subscribe: () => () => undefined,
    } as unknown as SettingsService,
    zoteroPref: {
      dataDir: "/nonexistent-zotero-data",
      baseAttachmentPath: null,
      on: () => () => undefined,
    },
  });
}

function makeService(
  app: ImportVaultApp,
  options: {
    existing?: TFile[];
    attachmentImport?: Pick<AttachmentImportService, "prepare">;
  } = {},
): NoteImporter {
  return createNoteImporter({
    app,
    noteIndex: { getImportedNoteByNoteKey: () => options.existing ?? [] },
    // `render` is generic (`<T>(name, data) => string`); a concrete mock can't
    // mirror that signature, so this one stub keeps a cast.
    template: { render: vi.fn(() => "[@cite]") } as Pick<
      TemplateService,
      "render"
    >,
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    attachmentImport: options.attachmentImport ?? makeAttachmentImport(),
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
  vi.mocked(getAnnotationsByKey).mockReturnValue([]);
  vi.mocked(renderAnnotations).mockReturnValue(new Map());
});

describe("createNoteImporter", () => {
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
    expect(link.indexedKey).toBe("NOTE1234");
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
    const batch = await makeService(app).prepare(PREPARE);

    const link = batch.resolveChildNote(makeNote({ groupID: 42 }));
    expect(link.indexedKey).toBe("NOTE1234g42");
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

  it("reuses the minted path across a second prepare() batch while the note index lags", async () => {
    // Simulates a double-triggered "Update in Obsidian": the note index hasn't
    // caught up (metadataCache 'changed' lands async after vault.create), so
    // both batches see no existing imported note for this key.
    const { app, create } = makeApp();
    const service = makeService(app);

    const batch1 = await service.prepare(PREPARE);
    const link1 = batch1.resolveChildNote(makeNote());
    const rendered1 = link1.noteLink();

    const batch2 = await service.prepare(PREPARE);
    const link2 = batch2.resolveChildNote(makeNote());
    const rendered2 = link2.noteLink();

    // Both renders resolve to the same minted path, not two distinct ones.
    expect(rendered2).toBe(rendered1);

    await batch1.flush();
    // The second batch's write attempt lands on the same already-created
    // path, so it hits the existing file-exists collision handling.
    create.mockRejectedValueOnce(new Error("File already exists."));
    await expect(batch2.flush()).resolves.toEqual({
      created: 0,
      skipped: 1,
      failed: 0,
    });

    // Only one path was ever minted for the key.
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toBe(create.mock.calls[1]![0]);
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

  it("renders annotations through the template when the setting is on, resolveLink bound to the note's batch", async () => {
    vi.mocked(renderAnnotations).mockReturnValue(
      new Map([["ANNOT1", "> [!note]\n>\n> callout"]]),
    );
    const { app, create } = makeApp();
    const attachmentImport = makeAttachmentImport();
    const batch = await makeService(app, { attachmentImport }).prepare(
      makePrepare({
        settings: { "note.import-annotations-as-template": true },
      }),
    );

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    // The service scopes the annotation lookup to the note's library.
    expect(getAnnotationsByKey).toHaveBeenCalledWith(
      expect.anything(),
      ["ANNOT1"],
      USER_LIBRARY_ID,
    );
    // The template-rendered callout lands in the written file.
    expect(create.mock.calls[0]![1]).toContain("> [!note]\n>\n> callout");

    // The attachment-import port handed to the renderer is the note's batch.
    const opts = vi.mocked(renderAnnotations).mock.calls[0]![2];
    const source = opts.attachmentImport.decide("/a.png", "annotation-cache");
    opts.attachmentImport.resolveLink({ source, vaultName: "a.png" });
    expect(attachmentImport.decide).toHaveBeenCalledWith(
      "/a.png",
      "annotation-cache",
    );
    expect(attachmentImport.resolveLink).toHaveBeenCalledWith({
      source,
      vaultName: "a.png",
    });
  });

  it("passes no annotation renderer to parseNote when the setting is off", async () => {
    const { app } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    expect(
      vi.mocked(parseNote).mock.calls[0]![2].renderAnnotationParagraph,
    ).toBeUndefined();
    expect(renderAnnotations).not.toHaveBeenCalled();
  });

  it("passes the colored highlight setting to the note parser", async () => {
    const { app } = makeApp();
    const batch = await makeService(app).prepare(
      makePrepare({ settings: { "note.import-colored-highlights": true } }),
    );

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    expect(
      vi.mocked(parseNote).mock.calls[0]![2].useColoredHighlightSyntax,
    ).toBe(true);
  });

  it("still writes a note whose embedded images are all blocked, as file:// embeds", async () => {
    const { app, create } = makeApp();
    const attachmentImport = makeBlockingAttachmentImport();
    await attachmentImport.ready;
    // Stand in for the parser's embedded-image rule: decide each image, then
    // embed whatever link resolution hands back.
    vi.mocked(parseNote).mockImplementationOnce((_td, _html, deps) =>
      ["/elsewhere/one.png", "/elsewhere/two.png"]
        .map((path) => {
          const source = deps.attachmentImport.decide(path, "linked-absolute");
          const link = deps.attachmentImport.resolveLink({
            source,
            vaultName: "image.png",
          });
          return `!${link()}`;
        })
        .join("\n"),
    );
    const batch = await makeService(app, { attachmentImport }).prepare(PREPARE);

    batch.resolveChildNote(makeNote()).noteLink();
    await expect(batch.flush()).resolves.toEqual({
      created: 1,
      skipped: 0,
      failed: 0,
    });

    const content = create.mock.calls[0]![1] as string;
    expect(content).toContain("![image.png](file:///elsewhere/one.png)");
    expect(content).toContain("![image.png](file:///elsewhere/two.png)");
    // No embed claims a vault file that was never written.
    expect(content).not.toContain("[[");
  });

  it("overwrites an existing note without creating the import folder", async () => {
    const { app, create, createFolder, process } = makeApp();
    const target = makeFile("Imported/Existing.md");
    const service = makeService(app);

    const outcome = await service.importNote(makeNote(), {
      client: {} as any,
      settings: PREPARE.settings,
      targetFile: target,
    });

    expect(outcome).toBe("overwritten");
    expect(process).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    // The deliberate fix: an overwrite never mints or ensures the import folder.
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("ensures the import folder on the create branch of importNote", async () => {
    const { app, create, createFolder } = makeApp();
    const service = makeService(app);

    const outcome = await service.importNote(makeNote(), {
      client: {} as any,
      settings: PREPARE.settings,
    });

    expect(outcome).toBe("created");
    expect(createFolder).toHaveBeenCalledExactlyOnceWith("Imported");
    expect(create).toHaveBeenCalledOnce();
  });
});
