import { Effect } from "effect";
import { stringifyYaml } from "obsidian";
import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { renderAnnotationSources } from "@/lib/annotation-render";
import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { AttachmentImportService } from "@/services/attachment-import/service";
import type {
  AttachmentSource,
  SourceOrigin,
} from "@/services/attachment-import/service";
import {
  profileReader,
  resolveProfile,
} from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import {
  inProcessReadsService,
  memoryOpener,
  recordCalls,
} from "@/services/zotero-reads/test-utils";

import { noteAnnotationKeys, parseNote } from "./note-parser";
import { createNoteImporter, NoteImportMintError } from "./service";
import type {
  ImportVaultApp,
  NoteImporter,
  PrepareNoteImportOptions,
} from "./service";

// The service owns the annotation renderer now; stub the leaf so the test asserts
// the wiring (resolveLink binding, library scoping) without the template pipeline.
vi.mock("@/lib/annotation-render", () => ({
  renderAnnotationSources: vi.fn(() => new Map<string, string>()),
}));

// `parseNote` is stubbed to echo its HTML and any annotation-callout output, so
// the service-built `renderAnnotationParagraph` is exercised through the write.
vi.mock("./note-parser", () => ({
  noteAnnotationKeys: vi.fn(() => []),
  noteReferences: vi.fn(() => ({ citedIndexedKeys: [], attachmentKeys: [] })),
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

const NOTE_BODY = "<h1>Methods</h1><p>body</p>";

/**
 * The Zotero rows every import reads: a parent item (1) with the child notes
 * the tests import — NOTE1234 in the personal library and in group 42, plus
 * NOTE0001/NOTE0002 — and an annotation ANNOT1 in each library.
 */
const SEED = `
  insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
  insert into groups (groupID, libraryID, name) values (42, 2, 'Team');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment'), (3, 'note'),
           (4, 'annotation');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'PRNT2345'),
      (50, 3, '2024-01-01 10:00:00', '2024-02-03 08:30:00', 1, 'NOTE1234'),
      (51, 3, '2024-01-01 10:00:00', '2024-02-03 08:30:00', 1, 'NOTE0001'),
      (52, 3, '2024-01-01 10:00:00', '2024-02-03 08:30:00', 1, 'NOTE0002'),
      (60, 3, '2024-01-01 10:00:00', '2024-02-03 08:30:00', 2, 'NOTE1234'),
      (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (70, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'ATCH2345'),
      (100, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNOT1'),
      (110, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'ANNOT1');
  insert into itemNotes (itemID, parentItemID, note, title)
    values (50, 1, '${NOTE_BODY}', 'Methods'),
           (51, 1, '${NOTE_BODY}', 'Methods'),
           (52, 1, '${NOTE_BODY}', 'Methods'),
           (60, null, '${NOTE_BODY}', 'Methods');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (10, 1, 0, 'application/pdf', 'storage:paper.pdf'),
           (70, null, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (
    itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex,
    position, isExternal
  )
    values
      (100, 10, 1, 'personal', null, '#ffd400', '1', '00000|000000|00000',
       '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0),
      (110, 70, 1, 'group', null, '#ffd400', '1', '00000|000000|00000',
       '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0);
`;

/** The reads every write in this suite runs on: the in-process adapter over {@link SEED}. */
const { reads } = await inProcessReadsService(memoryOpener(() => SEED).open)
  .ready;

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
    note: NOTE_BODY,
    dateAdded: Temporal.Instant.from("2024-01-01T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-02-03T08:30:00Z"),
  };
}

/** A host holding a note at each path, carrying the given Properties. */
function makeApp(
  propertiesByPath: Readonly<Record<string, Record<string, unknown>>> = {},
) {
  const host = createObsidianHost(
    Object.fromEntries(
      Object.entries(propertiesByPath).map(([path, properties]) => [
        path,
        noteText(properties),
      ]),
    ),
  );
  const app: ImportVaultApp = {
    ...host.app,
    fileManager: {
      // Mirrors Obsidian's (file, sourcePath, subpath, alias) signature.
      generateMarkdownLink: (...args: unknown[]) => {
        const file = args[0] as TFile;
        const alias = args[3] as string | undefined;
        return `[[${file.path}|${alias ?? ""}]]`;
      },
    },
  };
  return {
    app,
    host,
    create: vi.spyOn(host.vault, "create"),
    createFolder: vi.spyOn(host.vault, "createFolder"),
    process: vi.spyOn(host.vault, "process"),
  };
}

/** A note carrying `properties` over an empty body. */
function noteText(properties: Record<string, unknown>): string {
  return Object.keys(properties).length === 0
    ? ""
    : `---\n${stringifyYaml(properties)}---\n`;
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
    literatureNotes?: TFile[];
    attachmentImport?: Pick<AttachmentImportService, "prepare">;
    template?: Pick<
      TemplateService,
      "render" | "renderCitation" | "renderProfileAnnotation"
    >;
  } = {},
): NoteImporter {
  let current: Settings = defaults;
  const importer = createNoteImporter({
    profile: profileReader(() => current, app.metadataCache),
    app,
    noteIndex: {
      getImportedNoteByNoteKey: () => options.existing ?? [],
      getNotesByItemKey: () => options.literatureNotes ?? [],
    },
    // `render` is generic (`<T>(name, data) => string`); a concrete mock can't
    // mirror that signature, so this one stub keeps a cast.
    template:
      options.template ??
      ({
        render: vi.fn(() => "[@cite]"),
        renderCitation: vi.fn(() => "[@cite]"),
        renderProfileAnnotation: vi.fn(() => "profile annotation"),
      } as Pick<
        TemplateService,
        "render" | "renderCitation" | "renderProfileAnnotation"
      >),
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    attachmentImport: options.attachmentImport ?? makeAttachmentImport(),
  });
  return {
    prepare: (options) => {
      current = options.settings;
      return importer.prepare(options);
    },
    importNote: (note, options) => {
      current = options.settings;
      return importer.importNote(note, options);
    },
    prepareExplicitImport: (note, options) => {
      current = profileSettings();
      return importer.prepareExplicitImport(note, options);
    },
  };
}

function makePrepare(
  overrides: Omit<Partial<PrepareNoteImportOptions>, "settings"> & {
    settings?: Partial<ResolvedLiteratureNoteProfileBindings & Settings>;
  } = {},
): PrepareNoteImportOptions {
  const { settings: settingsOverrides, ...rest } = overrides;
  return {
    reads,
    sourcePath: "Literature/Paper.md",
    settings: {
      ...resolveProfile(defaults, "default").settings,
      "note.import-folder": "Imported",
      ...settingsOverrides,
    },
    ...rest,
  };
}

const PREPARE = makePrepare();

const PROFILE_A = "Bk3Qn7XvT2Lp" as ProfileId;
const PROFILE_B = "Rz9Wm4YfH6Kd" as ProfileId;

function profileSettings(): Settings {
  return {
    ...defaults,
    profiles: [
      {
        id: PROFILE_A,
        label: "Law",
        bindings: {
          "note.import-folder": "Law/Imported",
          "note.import-colored-highlights": true,
          "note.import-annotations-as-template": false,
        },
      },
      {
        id: PROFILE_B,
        label: "History",
        bindings: {
          "note.import-folder": "History/Imported",
          "note.import-colored-highlights": false,
          "note.import-annotations-as-template": true,
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(noteAnnotationKeys).mockReturnValue([]);
  vi.mocked(renderAnnotationSources).mockReturnValue(new Map());
});

describe("createNoteImporter", () => {
  it("skips when an existing note changes Profile after its import preview", async () => {
    const { app, host, process } = makeApp({
      "Imported/Existing.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_A },
    });
    const target = host.file("Imported/Existing.md");
    const service = makeService(app, { existing: [target] });
    const prepared = await service.prepareExplicitImport(makeNote(), {
      reads,
    });
    host.vault.modifyFile(
      target.path,
      noteText({ [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_B }),
    );

    await expect(
      prepared.import(makeNote(), {
        reads,
        settings: profileSettings(),
      }),
    ).resolves.toBe("skipped");
    expect(process).not.toHaveBeenCalled();
  });

  it("refuses an unknown orphan Profile before preparing any writes", async () => {
    const { app, create, createFolder } = makeApp();
    await expect(
      makeService(app).prepareExplicitImport(makeNote(), {
        reads,
        orphanProfile: "Qt5Nb8ZcV3Jm" as ProfileId,
      }),
    ).rejects.toMatchObject({
      name: "NoteImportProfileError",
      diagnostic: { stamp: "Qt5Nb8ZcV3Jm", indexedKey: "NOTE1234" },
    });
    expect(create).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("skips a collision at the previewed path without overwriting or copying attachments", async () => {
    const { app, create, process } = makeApp();
    const attachmentImport = makeAttachmentImport();
    const prepared = await makeService(app, {
      attachmentImport,
    }).prepareExplicitImport(makeNote(), {
      reads,
      orphanProfile: PROFILE_A,
    });
    create.mockRejectedValueOnce(new Error("File already exists."));

    await expect(
      prepared.import(makeNote(), {
        reads,
        settings: profileSettings(),
      }),
    ).resolves.toBe("skipped");
    expect(process).not.toHaveBeenCalled();
    expect(attachmentImport.flush).not.toHaveBeenCalled();
  });

  it.each(["existing", "parent"] as const)(
    "skips a prepared orphan if a %s note appears before confirmation",
    async (source) => {
      const { app, host, create, process } = makeApp();
      const existing: TFile[] = [];
      const literatureNotes: TFile[] = [];
      const service = makeService(app, { existing, literatureNotes });
      const note = makeNote();
      const prepared = await service.prepareExplicitImport(note, {
        reads,
        orphanProfile: PROFILE_A,
      });
      (source === "existing" ? existing : literatureNotes).push(
        host.vault.createFile("Arrived.md", ""),
      );

      await expect(
        prepared.import(note, {
          reads,
          settings: profileSettings(),
        }),
      ).resolves.toBe("skipped");
      expect(create).not.toHaveBeenCalled();
      expect(process).not.toHaveBeenCalled();
    },
  );

  it.each(["existing", "parent"] as const)(
    "keeps the %s Profile when an orphan choice is supplied",
    async (source) => {
      const { app, host, create } = makeApp({
        "History/Existing.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_B },
      });
      const target = host.file("History/Existing.md");
      const service = makeService(
        app,
        source === "existing"
          ? { existing: [target] }
          : { literatureNotes: [target] },
      );
      const prepared = await service.prepareExplicitImport(makeNote(), {
        reads,
        orphanProfile: PROFILE_A,
      });

      expect(prepared.source).toBe(source);
      expect(prepared.profile.selector).toBe(PROFILE_B);
      await prepared.import(makeNote(), {
        reads,
        settings: profileSettings(),
      });
      if (source === "existing") {
        expect(prepared.path).toBe(target.path);
        expect(create).not.toHaveBeenCalled();
        expect(host.text(target.path)).toContain("History (Rz9Wm4YfH6Kd)");
      } else {
        expect(prepared.path.startsWith("History/Imported/Methods_")).toBe(
          true,
        );
        expect(create.mock.calls[0]![0]).toBe(prepared.path);
        expect(create.mock.calls[0]![1]).toContain("History (Rz9Wm4YfH6Kd)");
      }
    },
  );

  it("prepares an orphan under its chosen Profile without writes and imports at the previewed path", async () => {
    const { app, create, createFolder } = makeApp();
    const service = makeService(app);
    const note = { ...makeNote(), parentItemID: null };
    const prepared = await service.prepareExplicitImport(note, {
      reads,
      orphanProfile: PROFILE_A,
    });

    expect(prepared.source).toBe("orphan");
    expect(prepared.profile.selector).toBe(PROFILE_A);
    expect(prepared.path.startsWith("Law/Imported/Methods_")).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();

    await expect(
      prepared.import(note, {
        reads,
        settings: profileSettings(),
      }),
    ).resolves.toBe("created");
    expect(create.mock.calls[0]![0]).toBe(prepared.path);
    expect(create.mock.calls[0]![1]).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Law (Bk3Qn7XvT2Lp)`,
    );
  });

  it("flushes Child Notes from the Snapshot the operation holds, across a refresh", async () => {
    // Open #2 holds a newer body: the refresh lands between render and flush.
    const { open } = memoryOpener(
      (n) =>
        SEED +
        (n === 1
          ? ""
          : "update itemNotes set note = '<p>refreshed</p>' where itemID = 50;"),
    );
    const { wrap, calls, snapshots } = recordCalls(["NoteBodies"]);
    const readsService = inProcessReadsService(open, wrap);
    const { app, create } = makeApp();
    using lease = await readsService.acquireRead();
    const batch = await makeService(app).prepare({
      ...PREPARE,
      reads: lease.reads,
    });

    batch.resolveChildNote(makeNote()).noteLink();
    await readsService.refresh();
    await batch.flush();

    expect(create.mock.calls[0]![1]).toContain(`md(${NOTE_BODY})`);
    expect(calls).toEqual([
      {
        operation: "NoteBodies",
        payload: { libraryID: 1, keys: ["NOTE1234"], snapshot: snapshots[0] },
      },
    ]);
    // The refresh landed: a read outside the Snapshot sees the new body.
    const { reads: current } = await readsService.ready;
    const [refreshed] = await Effect.runPromise(
      current.NoteBodies({ libraryID: 1, keys: ["NOTE1234"] }),
    );
    expect(refreshed!.note).toBe("<p>refreshed</p>");
  });

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

  it("stamps a side-effect import with the in-flight Literature Note Profile", async () => {
    const { app, create } = makeApp();
    const settings = resolveProfile(profileSettings(), PROFILE_A)!.settings;
    const batch = await makeService(app).prepare({
      ...PREPARE,
      settings,
    });

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    expect(create.mock.calls[0]![0]).toMatch(/^Law\/Imported\//);
    expect(create.mock.calls[0]![1]).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Law (Bk3Qn7XvT2Lp)`,
    );
    expect(
      vi.mocked(parseNote).mock.calls[0]![2].useColoredHighlightSyntax,
    ).toBe(true);
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
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    const link = batch.resolveChildNote(
      makeNote({ groupID: 42, libraryID: 2 }),
    );
    expect(link.indexedKey).toBe("NOTE1234g42");
    link.noteLink();
    await batch.flush();
    expect(create.mock.calls[0]![1]).toContain("zotero-note-key: NOTE1234g42");
  });

  it("links to an existing imported note by identity, queuing nothing", async () => {
    const { app, host, create } = makeApp({
      "Imported/Old name_abc123.md": {},
    });
    const existing = host.file("Imported/Old name_abc123.md");
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
    const { app, create } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote({ key: "GONE2345" })).noteLink();
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
    const { app, host } = makeApp({ "occupied.md": {} });
    // Any path the mint checks reports as occupied, forcing the hard collision.
    vi.spyOn(host.vault, "getAbstractFileByPath").mockReturnValue(
      host.file("occupied.md"),
    );
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
    vi.mocked(noteAnnotationKeys).mockReturnValue(["ANNOT1"]);
    vi.mocked(renderAnnotationSources).mockReturnValue(
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
    const [sources] = vi.mocked(renderAnnotationSources).mock.calls[0]!;
    expect(
      sources.annotations.map(({ key, libraryID, text }) => ({
        key,
        libraryID,
        text,
      })),
    ).toEqual([
      { key: "ANNOT1", libraryID: USER_LIBRARY_ID, text: "personal" },
    ]);
    // The template-rendered callout lands in the written file.
    expect(create.mock.calls[0]![1]).toContain("> [!note]\n>\n> callout");

    // The attachment-import port handed to the renderer is the note's batch.
    const opts = vi.mocked(renderAnnotationSources).mock.calls[0]![1];
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

  it("renders annotation paragraphs through the imported note's Profile", async () => {
    const renderProfileAnnotation = vi.fn(() => "profile annotation");
    const template = {
      render: vi.fn(() => "[@cite]"),
      renderCitation: vi.fn(() => "[@cite]"),
      renderProfileAnnotation,
    } as Pick<
      TemplateService,
      "render" | "renderCitation" | "renderProfileAnnotation"
    >;
    const { app } = makeApp();
    const settings = resolveProfile(profileSettings(), PROFILE_B)!.settings;
    const batch = await makeService(app, { template }).prepare({
      ...PREPARE,
      settings,
    });

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    const render = vi.mocked(renderAnnotationSources).mock.calls[0]![1]
      .renderAnnotation;
    expect(render?.({ text: "Excerpt" } as never)).toBe("profile annotation");
    expect(renderProfileAnnotation).toHaveBeenCalledWith(
      { text: "Excerpt" },
      {
        profile: expect.objectContaining({
          selector: PROFILE_B,
          label: "History",
          stamp: "History (Rz9Wm4YfH6Kd)",
        }),
      },
    );
  });

  it("passes no annotation renderer to parseNote when the setting is off", async () => {
    const { app } = makeApp();
    const batch = await makeService(app).prepare(PREPARE);

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    expect(
      vi.mocked(parseNote).mock.calls[0]![2].renderAnnotationParagraph,
    ).toBeUndefined();
    expect(renderAnnotationSources).not.toHaveBeenCalled();
  });

  it("passes the colored highlight toggle and mappings to the note parser", async () => {
    const { app } = makeApp();
    const mappings = { blue: { output: "custom", customEmoji: "👩‍🔬" } } as const;
    const batch = await makeService(app).prepare(
      makePrepare({
        settings: {
          "note.import-colored-highlights": true,
          "note.import-highlight-mappings": mappings,
        },
      }),
    );

    batch.resolveChildNote(makeNote()).noteLink();
    await batch.flush();

    expect(
      vi.mocked(parseNote).mock.calls[0]![2].useColoredHighlightSyntax,
    ).toBe(true);
    expect(vi.mocked(parseNote).mock.calls[0]![2].highlightMappings).toEqual(
      mappings,
    );
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
    // Outside the import folder, so ensuring that folder would create it.
    const { app, host, create, createFolder, process } = makeApp({
      "Notes/Existing.md": {},
    });
    const target = host.file("Notes/Existing.md");
    const service = makeService(app);

    const outcome = await service.importNote(makeNote(), {
      reads,
      settings: PREPARE.settings,
      targetFile: target,
    });

    expect(outcome).toBe("overwritten");
    expect(process).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    // The deliberate fix: an overwrite never mints or ensures the import folder.
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("follows and re-emits the existing stamp on whole-body overwrite", async () => {
    const { app, host, createFolder } = makeApp({
      "Imported/Existing.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_A },
    });
    const target = host.file("Imported/Existing.md");
    const service = makeService(app);

    await service.importNote(makeNote(), {
      reads,
      settings: profileSettings(),
      targetFile: target,
    });

    expect(host.text(target.path)).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Law (Bk3Qn7XvT2Lp)`,
    );
    expect(
      vi.mocked(parseNote).mock.calls[0]![2].useColoredHighlightSyntax,
    ).toBe(true);
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("refreshes a stale hint to the Profile's current label on re-import", async () => {
    const { app, host } = makeApp({
      "Imported/Existing.md": {
        [FIELD_LITERATURE_NOTE_PROFILE]: `Statutes (${PROFILE_A})`,
      },
    });
    const target = host.file("Imported/Existing.md");
    const service = makeService(app);

    await service.importNote(makeNote(), {
      reads,
      settings: profileSettings(),
      targetFile: target,
    });

    expect(host.text(target.path)).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Law (Bk3Qn7XvT2Lp)`,
    );
  });

  it("treats a stampless overwrite as the default Profile", async () => {
    const { app, host } = makeApp({ "Imported/Existing.md": {} });
    const target = host.file("Imported/Existing.md");
    const settings: Settings = {
      ...defaults,
      "note.default-profile": {
        ...defaults["note.default-profile"],
        bindings: {
          ...defaults["note.default-profile"].bindings,
          "note.import-colored-highlights": true,
        },
      },
    };
    const service = makeService(app);

    await service.importNote(makeNote(), {
      reads,
      settings,
      targetFile: target,
    });

    expect(
      vi.mocked(parseNote).mock.calls[0]![2].useColoredHighlightSyntax,
    ).toBe(true);
    expect(host.text(target.path)).not.toContain(FIELD_LITERATURE_NOTE_PROFILE);
  });

  it("converts one mixed batch under each Imported Note stamp", async () => {
    const { app, host } = makeApp({
      "Imported/First.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_A },
      "Imported/Second.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_B },
    });
    const first = host.file("Imported/First.md");
    const second = host.file("Imported/Second.md");
    const service = makeService(app);
    const settings = profileSettings();

    await Promise.all([
      service.importNote(makeNote({ key: "NOTE0001" }), {
        reads,
        settings,
        targetFile: first,
      }),
      service.importNote(makeNote({ key: "NOTE0002" }), {
        reads,
        settings,
        targetFile: second,
      }),
    ]);

    const parserOptions = vi
      .mocked(parseNote)
      .mock.calls.map((call) => call[2]);
    expect(parserOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ useColoredHighlightSyntax: true }),
        expect.objectContaining({
          useColoredHighlightSyntax: false,
          renderAnnotationParagraph: expect.any(Function),
        }),
      ]),
    );
  });

  it("refuses an unknown Imported Note stamp with a recovery diagnostic", async () => {
    const unknown = "Qt5Nb8ZcV3Jm";
    const { app, host, process } = makeApp({
      "Imported/Unknown.md": { [FIELD_LITERATURE_NOTE_PROFILE]: unknown },
    });
    const target = host.file("Imported/Unknown.md");
    const service = makeService(app);

    await expect(
      service.importNote(makeNote(), {
        reads,
        settings: profileSettings(),
        targetFile: target,
      }),
    ).rejects.toMatchObject({
      name: "NoteImportProfileError",
      message: m.notice_imported_note_profile_unknown({
        stamp: unknown,
        target: target.path,
      }),
      diagnostic: {
        code: "unknown-literature-note-profile",
        hint: expect.stringContaining("Switch profile..."),
        recovery: { action: "switch-profile" },
        stamp: unknown,
        path: target.path,
      },
    });
    expect(process).not.toHaveBeenCalled();
  });

  it("keeps the parent Literature Note path and kind when a new child inherits an unavailable Profile", async () => {
    const { app, host, create, process } = makeApp({
      "Literature/Parent.md": { [FIELD_LITERATURE_NOTE_PROFILE]: "Missing" },
    });
    const parent = host.file("Literature/Parent.md");
    const service = makeService(app, { literatureNotes: [parent] });
    await expect(
      service.importNote(makeNote(), {
        reads,
        settings: profileSettings(),
      }),
    ).rejects.toMatchObject({
      imported: false,
      message: m.notice_literature_note_profile_unknown({ stamp: "Missing" }),
      diagnostic: { path: parent.path, recovery: { action: "switch-profile" } },
    });
    expect(create).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  it("ensures the import folder on the create branch of importNote", async () => {
    const { app, create, createFolder } = makeApp();
    const service = makeService(app);
    const settings: Settings = {
      ...defaults,
      "note.default-profile": {
        ...defaults["note.default-profile"],
        bindings: {
          ...defaults["note.default-profile"].bindings,
          "note.import-folder": "Imported",
        },
      },
    };

    const outcome = await service.importNote(makeNote(), {
      reads,
      settings,
    });

    expect(outcome).toBe("created");
    expect(createFolder).toHaveBeenCalledExactlyOnceWith("Imported");
    expect(create).toHaveBeenCalledOnce();
  });

  it("copies the parent Literature Note stamp on explicit attached-note creation", async () => {
    const { app, host, create } = makeApp({
      "Law/Parent.md": { [FIELD_LITERATURE_NOTE_PROFILE]: PROFILE_A },
    });
    const literatureNote = host.file("Law/Parent.md");
    const service = makeService(app, { literatureNotes: [literatureNote] });

    await service.importNote(makeNote(), {
      reads,
      settings: profileSettings(),
    });

    expect(create.mock.calls[0]![0]).toMatch(/^Law\/Imported\//);
    expect(create.mock.calls[0]![1]).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Law (Bk3Qn7XvT2Lp)`,
    );
  });

  it("uses the default Profile when an attached note has no Literature Note", async () => {
    const { app, create } = makeApp();
    const service = makeService(app);

    await service.importNote(makeNote(), {
      reads,
      settings: profileSettings(),
    });

    expect(create.mock.calls[0]![0]).toMatch(/^zotero_notes\//);
    expect(create.mock.calls[0]![1]).not.toContain(
      FIELD_LITERATURE_NOTE_PROFILE,
    );
  });
});
