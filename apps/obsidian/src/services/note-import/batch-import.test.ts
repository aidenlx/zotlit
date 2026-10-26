import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect";
import { TFile } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { beforeEach, describe, expect, vi } from "vitest";

import { formatIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";
import type { ChildNote, Library, Note } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema, rowInstant } from "@zotlit/db/test-utils";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { ProfileId } from "@/lib/profile-stamp";
import { excerptReuseProbe } from "@/services/excerpt-image/__fixtures__/reuse";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type {
  AvailableLibrary,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorOf } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { ProfileAnnotationError } from "@/services/template/service";
import type { TestReads } from "@/services/zotero-reads/__fixtures__";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsState } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  recordCalls,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";
import type {
  BatchClassifyControls,
  BatchModalOptions,
  BatchRunControls,
  FlatTask,
} from "@/views/batch-modal";

import { runBatchImport } from "./batch-import";
import type { BatchImport, BatchImportPorts } from "./batch-import";
import type { BatchImportServices } from "./batch-import";
import { bindBatchImport } from "./batch-import-handle";
import {
  batchImportNotice,
  batchImportToast,
  childImportToast,
} from "./batch-import-notices";
import { NoteImporter, NoteImportProfileError } from "./service";
import type {
  ImportNoteOptions,
  PreparedExplicitImport,
  WriteOutcome,
} from "./service";
import type { NoteImportView } from "./view";

/** Captured options of every batch modal the runner opened via its view port. */
const openedModals: BatchModalOptions[] = [];
/** Stub for the view port's overwrite confirm; controlled per overwrite test. */
const confirmMock = vi.fn();

// Stub only the DOM-bound manifests so classify/run drive the real batch-run
// mechanics (imported from @/services/batch-run, left unmocked) headlessly.
vi.mock("@/views/batch-modal", () => {
  class FlatManifest {
    constructor(readonly options: unknown) {}
  }
  class HierarchyManifest {
    constructor(readonly options: unknown) {}
  }
  return { FlatManifest, HierarchyManifest };
});

function classifyControls(): BatchClassifyControls {
  return { onProgress: vi.fn(), signal: new AbortController().signal };
}

/** Drive the last opened modal through its loading + run phases, returning the
 * built manifest's captured options and the per-item settle spy. */
async function driveLastModal(): Promise<{
  manifest: { options: any };
  onItemSettled: ReturnType<typeof vi.fn>;
}> {
  const opts = openedModals.at(-1);
  if (!opts) throw new Error("no modal was opened");
  const manifest = (await opts.onClassify(classifyControls())) as unknown as {
    options: any;
  };
  const onItemSettled = vi.fn();
  const controls: BatchRunControls = {
    onItemSettled,
    stop: Deferred.makeUnsafe<void>(),
  };
  await opts.onRun(controls);
  return { manifest, onItemSettled };
}

function makeRef(itemID: number, libraryID = USER_LIBRARY_ID): ChildNote {
  const key = `NOTE${itemID}`;
  return {
    itemID,
    libraryID,
    groupID: libraryID === USER_LIBRARY_ID ? null : 7,
    parentItemID: PARENT_ITEM_ID,
    key,
    indexedKey: formatIndexedKey(key, null),
    title: `Note ${itemID}`,
    dateModified: rowInstant("2024-02-03T08:30:00Z"),
  };
}

/**
 * The `:memory:` Zotero database every fixture reads: My Library, the
 * "Reading group" library (local id 12, group 7), and the regular item
 * {@link PARENT_ITEM_ID}, the parent {@link makeRef} names. Each test seeds
 * the notes it reads.
 */
let db: NodeDatabaseClient;

/** The regular item every seeded note hangs from unless a test says otherwise. */
const PARENT_ITEM_ID = 900;

const BASE_ROWS = `
  insert into libraries (libraryID, type) values (1, 'user'), (12, 'group');
  insert into groups (groupID, libraryID, name) values (7, 12, 'Reading group');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (3, 'note');
  insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0);
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values (900, 1, '2024-01-01 10:00:00', '2024-01-01 10:00:00', 1, 'PARENT01');
  insert into itemDataValues (valueID, value) values (1, 'Parent paper');
  insert into itemData (itemID, fieldID, valueID) values (900, 10, 1);
`;

/**
 * Seed the live notes `itemIDs`, each as {@link makeNote} describes it: key
 * `NOTE<id>` (or `key`), title `Note <id>`, a child of `parentItemID`.
 */
function seedNotes(
  itemIDs: readonly number[],
  {
    libraryID = USER_LIBRARY_ID,
    parentItemID = PARENT_ITEM_ID as number | null,
    key,
  }: { libraryID?: number; parentItemID?: number | null; key?: string } = {},
): void {
  for (const itemID of itemIDs) {
    db.$client
      .prepare(
        `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
           values (?, 3, '2024-01-01 10:00:00', '2024-02-03 08:30:00', ?, ?)`,
      )
      .run(itemID, libraryID, key ?? `NOTE${itemID}`);
    db.$client
      .prepare(
        "insert into itemNotes (itemID, parentItemID, note, title) values (?, ?, ?, ?)",
      )
      .run(
        itemID,
        parentItemID,
        "<h1>Methods</h1><p>body</p>",
        `Note ${itemID}`,
      );
  }
}

/** Seed a collection of `libraryID` holding the standalone notes `itemIDs`. */
function seedCollection(
  key: string,
  libraryID: number,
  itemIDs: readonly number[],
): void {
  db.$client
    .prepare(
      "insert into collections (collectionID, collectionName, libraryID, key) values (100, 'Reading', ?, ?)",
    )
    .run(libraryID, key);
  for (const itemID of itemIDs)
    db.$client
      .prepare(
        "insert into collectionItems (collectionID, itemID) values (100, ?)",
      )
      .run(itemID);
}

function makeNote(itemID: number): Note {
  return {
    ...makeRef(itemID),
    note: "<h1>Methods</h1><p>body</p>",
    dateAdded: rowInstant("2024-01-01T10:00:00Z"),
  };
}

function makeIndexedNote(key = "ABCD2345"): Note {
  return {
    ...makeNote(50),
    key,
    indexedKey: formatIndexedKey(key, null),
  };
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const PERSONAL_LIBRARY: Library = {
  libraryID: USER_LIBRARY_ID,
  version: 0,
  clientVersion: null,
  type: "user",
  groupID: null,
  name: null,
};

/** A group whose local id sorts after the personal library's own row order. */
const GROUP_LIBRARY: Library = {
  libraryID: 12,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

function availableLibrary(library: Library): AvailableLibrary {
  return {
    selector: selectorOf(library)!,
    libraryID: library.libraryID,
    name: library.name,
  };
}

function scopeOf(
  libraries: readonly Library[],
  unavailable: readonly LibrarySelector[] = [],
): ResolvedLibraryScope {
  return {
    mode: "selected",
    invalid: false,
    available: libraries.map(availableLibrary),
    unavailable,
  };
}

/** The Library Scope every fixture resolves, unless a test replaces it. */
let currentScope: ResolvedLibraryScope = scopeOf([PERSONAL_LIBRARY]);

/** A prepared import whose write a case states as a Promise. */
type PromisePreparedImport = Omit<PreparedExplicitImport, "import"> & {
  import(note: Note, options: ImportNoteOptions): Promise<WriteOutcome>;
};

/** The note importer as a case states it: its writes as Promises. */
interface PromiseNoteImporter {
  prepareExplicitImport: (
    note: ChildNote,
    options: Parameters<NoteImporter["Service"]["prepareExplicitImport"]>[1],
  ) => Promise<PromisePreparedImport>;
  importNote: (note: Note, options: ImportNoteOptions) => Promise<WriteOutcome>;
}

/** What a case gives the batch import, in the plain shapes it states them in. */
interface ImportDeps {
  noteFeature: BatchImportPorts["noteFeature"];
  view: NoteImportView;
  profile: ProfileReader;
  zoteroReads: TestReads;
  dbState: ZoteroReadsState["state"];
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  noteImport: PromiseNoteImporter;
  noteIndex: {
    whenIndexed(): Promise<void>;
    getImportedNoteByNoteKey(noteKey: string): TFile[];
  };
  metadataCache: { getFileCache(file: TFile): CachedMetadata | null };
}

/**
 * A case's Promise as the importer answers: a {@link NoteImportProfileError}
 * it rejects with is the importer's typed failure, anything else a defect.
 */
const settled = <A>(call: () => Promise<A>) =>
  Effect.promise(() => call()).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof NoteImportProfileError
        ? Effect.fail(defect)
        : Effect.die(defect),
    ),
  );

/**
 * The real {@link bindBatchImport}, as `build.ts` binds it, over services
 * that answer from `deps` at the time of each call. The case's resources
 * dispose the runtime.
 */
function importOver(deps: ImportDeps): BatchImport {
  const runtime = buildRuntime(layerOver(deps), caseResources);
  return bindBatchImport(
    effectBridge(runtime),
    runtime.runSync(Effect.context<BatchImportServices>()),
    portsOf(deps),
  );
}

/** The ports a batch import takes, from the case's `deps`. */
function portsOf(deps: ImportDeps): Omit<BatchImportPorts, "bridge"> {
  return { view: deps.view, noteFeature: deps.noteFeature };
}

/** The services a batch import reads, answering from `deps` at each call. */
function layerOver(deps: ImportDeps): Layer.Layer<BatchImportServices> {
  return Layer.mergeAll(
    Layer.mock(LibraryScope, {
      resolveLibraries: () => Effect.sync(() => currentScope),
    }),
    Layer.mock(MetadataCache, {
      fileCache: (file) =>
        Effect.sync(() => deps.metadataCache.getFileCache(file)),
    }),
    Layer.mock(NoteImporter, {
      importNote: (note, options) =>
        settled(() => deps.noteImport.importNote(note, options)),
      prepareExplicitImport: (note, options) =>
        Effect.map(
          settled(() => deps.noteImport.prepareExplicitImport(note, options)),
          (prepared): PreparedExplicitImport => ({
            ...prepared,
            import: (current, runOptions) =>
              settled(() => prepared.import(current, runOptions)),
          }),
        ),
    }),
    Layer.mock(NoteIndex, {
      whenIndexed: Effect.promise(() => deps.noteIndex.whenIndexed()),
      getImportedNoteByNoteKey: (noteKey) =>
        Effect.sync(() => deps.noteIndex.getImportedNoteByNoteKey(noteKey)),
    }),
    Layer.mock(PluginSettings, {
      current: Effect.suspend(() => deps.settings.current),
      update: (patch) => deps.settings.update(patch),
    }),
    Layer.mock(Profile, {
      profiles: Effect.sync(() => deps.profile.profiles),
      resolveProfile: (selector) =>
        Effect.sync(() => deps.profile.resolveProfile(selector)),
    }),
    Layer.mock(ZoteroReads, {
      current: Effect.sync(() =>
        stubService<ZoteroReadsState>("ZoteroReadsState", {
          state: deps.dbState,
        }),
      ),
      reads: deps.zoteroReads.reads,
      snapshot: deps.zoteroReads.snapshot,
    }),
  );
}

function makeDeps(
  settings: Partial<Settings>,
  options: {
    dbState?: "loading" | "ready" | "degraded";
    importNoteResult?: "created" | "overwritten" | "skipped";
    existing?: TFile[];
    /** Per-file frontmatter cache for metadataCache.getFileCache. */
    frontmatter?: Map<TFile, Record<string, unknown>>;
    /** Observes or replaces operations at the ZoteroReads interface. */
    wrap?: (client: ZoteroReadsClient) => ZoteroReadsClient;
  } = {},
): {
  deps: ImportDeps;
  importNote: ReturnType<typeof vi.fn>;
} {
  const importNote = vi.fn(
    async () => options.importNoteResult ?? ("created" as const),
  );
  const zoteroReads = caseResources.use(
    inProcessReadsService(sharedClientOpener(db), { wrap: options.wrap }),
  );
  const deps: ImportDeps = {
    profile: profileReader(),
    noteFeature: {
      reportExcerptImages: vi.fn(),
      resolveCreationProfile: async () => ({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      }),
    },
    zoteroReads,
    dbState: options.dbState ?? "ready",
    settings: {
      current: Effect.succeed({ ...defaults, ...settings }),
      update: ((patch) =>
        Effect.succeed({
          ...defaults,
          ...settings,
          ...(typeof patch === "function"
            ? patch({ ...defaults, ...settings })
            : patch),
        })) as PluginSettings["Service"]["update"],
    },
    noteImport: {
      importNote,
      prepareExplicitImport:
        vi.fn<PromiseNoteImporter["prepareExplicitImport"]>(),
    },
    noteIndex: {
      whenIndexed: async () => {},
      getImportedNoteByNoteKey: () => options.existing ?? [],
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = options.frontmatter?.get(file);
        return fm ? { frontmatter: fm } : null;
      },
    },
    view: {
      openBatchModal: (opts) => {
        openedModals.push(opts);
      },
      confirm: (options) =>
        Effect.promise(async () => (await confirmMock(options)) === true),
      chooseProfile: vi.fn(),
    },
  };
  return { deps, importNote };
}

it("lets the batch chip change only orphans while existing and parent stamps remain fixed", async () => {
  const books = "Bk3Qn7XvT2Lp" as ProfileId;
  const papers = "Rz9Wm4YfH6Kd" as ProfileId;
  const { deps } = makeDeps({});
  deps.profile = profileReader({
    ...defaults,
    profiles: [
      { id: books, label: "Books" },
      { id: papers, label: "Papers" },
    ],
  });
  deps.noteFeature.resolveCreationProfile = async () => ({
    selector: papers,
    source: "headless",
    shouldAsk: true,
  });
  const existing = makeFile("Books/Imported.md");
  deps.noteIndex.getImportedNoteByNoteKey = (key) =>
    key === makeRef(1).indexedKey ? [existing] : [];
  seedNotes([1, 2, 3]);
  const imports = vi.fn(async (note: Note) =>
    note.itemID === 1 ? ("overwritten" as const) : ("created" as const),
  );
  vi.mocked(deps.noteImport.prepareExplicitImport).mockImplementation(
    async (note, options) => {
      const source =
        note.itemID === 1
          ? "existing"
          : note.itemID === 2
            ? "parent"
            : "orphan";
      const selector =
        source === "existing"
          ? books
          : source === "parent"
            ? papers
            : options.orphanProfile!;
      const profile = deps.profile.resolveProfile(selector)!;
      return {
        source,
        profile,
        path: `${profile.label}/Note${note.itemID}.md`,
        import: imports,
      };
    },
  );
  using chooseProfile = vi
    .spyOn(deps.view, "chooseProfile")
    .mockResolvedValue(books);
  using settingsUpdate = vi.spyOn(deps.settings, "update");
  await importOver(deps).runBatchImport("note", [1, 2, 3]);
  const options = openedModals.at(-1)!;
  const manifest = (await options.onClassify(classifyControls())) as any;
  const choice = manifest.options.groups.find(
    (group: any) => group.profileChoice,
  )?.profileChoice;
  expect(choice.label).toBe("Papers");
  expect(settingsUpdate).not.toHaveBeenCalled();
  await choice.choose();
  expect(manifest.options.tasks).toMatchObject([
    { id: 1, profile: "Books" },
    { id: 2, profile: "Papers", path: "Papers/Note2.md" },
    { id: 3, profile: "Books", path: "Books/Note3.md" },
  ]);
  expect(choice.source).toBe("asked");
  expect(chooseProfile).toHaveBeenCalledOnce();
  expect(imports).not.toHaveBeenCalled();
  expect(
    manifest.options.groups.filter((group: any) => group.profileChoice),
  ).toHaveLength(1);
  expect(manifest.options.tasks[2].kind).not.toBe(
    manifest.options.tasks[1].kind,
  );
  expect(settingsUpdate).not.toHaveBeenCalled();
  const result = await options.onRun({
    onItemSettled: vi.fn(),
    stop: Deferred.makeUnsafe<void>(),
  });
  expect(result).toMatchObject({
    created: 2,
    updated: 1,
    failed: 0,
    skipped: 0,
  });
  expect(settingsUpdate).not.toHaveBeenCalled();
  expect(
    options.text.runSummary(result, { cancelled: false, aborted: false }),
  ).toBe(
    m.batch_profile_summary({
      created: `${m.batch_profile_created({ count: 1, label: "Books" })}, ${m.batch_profile_created({ count: 1, label: "Papers" })}`,
      updated: m.batch_profile_updated({ count: 1, label: "Books" }),
      failed: 0,
      skipped: 0,
      kept: 0,
      notFound: 0,
    }),
  );
});

it("keeps parent-only imports read-only without a settings write", async () => {
  const books = "Bk3Qn7XvT2Lp" as ProfileId;
  const { deps } = makeDeps({});
  deps.profile = profileReader({
    ...defaults,
    profiles: [{ id: books, label: "Books" }],
  });
  seedNotes([1, 2], { parentItemID: 10 });
  vi.mocked(deps.noteImport.prepareExplicitImport).mockImplementation(
    async (note) => ({
      source: "parent",
      profile: deps.profile.resolveProfile(books)!,
      path: `Books/Note${note.itemID}.md`,
      import: async () => "created",
    }),
  );
  using chooseProfile = vi.spyOn(deps.view, "chooseProfile");
  using settingsUpdate = vi.spyOn(deps.settings, "update");
  await importOver(deps).runBatchImport("child", [10]);
  const options = openedModals.at(-1)!;
  const manifest = (await options.onClassify(classifyControls())) as any;
  expect(manifest.options.parents[0].profileChoice).toBeUndefined();
  expect(manifest.options.parents[0].children).toMatchObject([
    { profile: "Books" },
    { profile: "Books" },
  ]);
  expect(
    await options.onRun({
      onItemSettled: vi.fn(),
      stop: Deferred.makeUnsafe<void>(),
    }),
  ).toMatchObject({ created: 2, failed: 0 });
  expect(chooseProfile).not.toHaveBeenCalled();
  expect(settingsUpdate).not.toHaveBeenCalled();
});

it.each([true, false])(
  "shows an unknown Imported Note stamp and keeps recovery (additional Profiles: %s)",
  async (additionalProfiles) => {
    const stamp = "Retired (Qw8Er5Ty2Ui9)";
    const file = makeFile("Imported/Methods.md");
    const { deps, importNote } = makeDeps({}, { existing: [file] });
    deps.profile = profileReader(
      {
        ...defaults,
        profiles: additionalProfiles
          ? [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }]
          : [],
      },
      { getFileCache: () => ({ frontmatter: { "zotlit-profile": stamp } }) },
    );
    const error = NoteImportProfileError.unknown(stamp, { path: file.path });
    vi.mocked(deps.noteImport.prepareExplicitImport).mockRejectedValue(error);
    importNote.mockRejectedValue(error);
    seedNotes([1]);
    await importOver(deps).runBatchImport("note", [1, 2]);
    const options = openedModals.at(-1)!;
    const manifest = (await options.onClassify(classifyControls())) as any;
    expect(manifest.options.tasks).toMatchObject([{ id: 1 }]);
    expect(manifest.options.tasks[0].profile).toBe(
      additionalProfiles ? stamp : undefined,
    );
    expect(
      manifest.options.groups.some((group: any) => group.profileChoice),
    ).toBe(false);
    const onItemSettled = vi.fn();
    expect(
      await options.onRun({
        onItemSettled,
        stop: Deferred.makeUnsafe<void>(),
      }),
    ).toMatchObject({ created: 0, updated: 0, failed: 1 });
    expect(onItemSettled).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      status: "failed",
      failure: {
        label: "Note 1",
        message: m.notice_imported_note_profile_unknown({
          stamp,
          target: file.path,
        }),
        recovery: { action: "switch-profile", path: file.path },
      },
    });
  },
);

/** The database and the read services the current case opened over it. */
let caseResources: AsyncDisposableStack;

beforeEach(() => {
  openedModals.length = 0;
  caseResources = new AsyncDisposableStack();
  db = caseResources.adopt(createClient(":memory:"), (client) =>
    client.$client.close(),
  );
  createFixtureSchema(db.$client);
  db.$client.exec(BASE_ROWS);
  currentScope = scopeOf([PERSONAL_LIBRARY]);
  confirmMock.mockReset();
  return () => caseResources.disposeAsync();
});

describe("classify through the NoteRefs stream", () => {
  it("classifies from one NoteRefs stream and loads each note under the run's Snapshot", async () => {
    const recorded = recordCalls(["NoteRefs", "NoteBodies"]);
    const { deps, importNote } = makeDeps({}, { wrap: recorded.wrap });
    seedNotes([1, 2]);
    const progress: number[] = [];

    await importOver(deps).runBatchImport("note", [1, 2, 3]);
    const modal = openedModals.at(-1)!;
    const manifest = (await modal.onClassify({
      onProgress: (classified) => progress.push(classified),
      signal: new AbortController().signal,
    })) as any;
    const result = await modal.onRun({
      onItemSettled: vi.fn(),
      stop: Deferred.makeUnsafe<void>(),
    });

    expect(progress).toEqual([3]);
    expect(manifest.options.notFound).toEqual([
      { itemID: 3, label: m.batch_import_item_not_note({ id: 3 }) },
    ]);
    expect(result).toMatchObject({ created: 2, failed: 0 });
    expect(importNote).toHaveBeenCalledTimes(2);
    const [classify, ...loads] = recorded.calls;
    expect(classify).toMatchObject({
      operation: "NoteRefs",
      payload: { itemIDs: [1, 2, 3] },
    });
    expect(loads.map(({ operation }) => operation)).toEqual([
      "NoteBodies",
      "NoteBodies",
    ]);
    // Classify reads its own Snapshot; the run's note loads share another.
    const [classifySnapshot, runSnapshot] = recorded.snapshots;
    expect(classify!.payload.snapshot).toBe(classifySnapshot);
    for (const load of loads) expect(load.payload.snapshot).toBe(runSnapshot);
    expect(runSnapshot).not.toBe(classifySnapshot);
  });

  it("interrupts the NoteRefs stream when Cancel lands during classify", async () => {
    let interrupted = false;
    const { deps } = makeDeps(
      {},
      {
        wrap: (client) => ({
          ...client,
          // The first slice arrives; the next one never does until interrupted.
          NoteRefs: ((payload: object, options?: object) =>
            Stream.concat(
              (
                client.NoteRefs as unknown as (
                  payload: object,
                  options?: object,
                ) => Stream.Stream<unknown>
              )(payload, options),
              Stream.never,
            ).pipe(
              Stream.onExit((exit) =>
                Effect.sync(() => {
                  interrupted = Exit.hasInterrupts(exit);
                }),
              ),
            )) as unknown as ZoteroReadsClient["NoteRefs"],
        }),
      },
    );
    seedNotes([1]);
    const abort = new AbortController();

    await importOver(deps).runBatchImport("note", [1, 2]);
    const classified = openedModals.at(-1)!.onClassify({
      onProgress: () => abort.abort(),
      signal: abort.signal,
    });

    await expect(classified).rejects.toThrow();
    expect(interrupted).toBe(true);
  });

  it("interrupts a classify still running when the plugin unloads", async () => {
    let interrupted = false;
    const { deps } = makeDeps(
      {},
      {
        wrap: (client) => ({
          ...client,
          NoteRefs: ((payload: object, options?: object) =>
            Stream.concat(
              (
                client.NoteRefs as unknown as (
                  payload: object,
                  options?: object,
                ) => Stream.Stream<unknown>
              )(payload, options),
              Stream.never,
            ).pipe(
              Stream.onExit((exit) =>
                Effect.sync(() => {
                  interrupted = Exit.hasInterrupts(exit);
                }),
              ),
            )) as unknown as ZoteroReadsClient["NoteRefs"],
        }),
      },
    );
    seedNotes([1]);
    // The plugin's runtime: unloading disposes it.
    const plugin = new AsyncDisposableStack();
    const runtime = buildRuntime(layerOver(deps), plugin);
    await bindBatchImport(
      effectBridge(runtime),
      runtime.runSync(Effect.context<BatchImportServices>()),
      portsOf(deps),
    ).runBatchImport("note", [1, 2]);
    const firstSlice = Promise.withResolvers<void>();

    const classified = openedModals.at(-1)!.onClassify({
      onProgress: () => firstSlice.resolve(),
      signal: new AbortController().signal,
    });
    await firstSlice.promise;
    await plugin.disposeAsync();

    await expect(classified).rejects.toThrow();
    expect(interrupted).toBe(true);
  });
});

describe("runBatchImportAll", () => {
  const COLLECTION = "ABCD2345";

  it("returns db-unavailable when the database is closed", async () => {
    const { deps } = makeDeps({}, { dbState: "loading" });

    await expect(importOver(deps).runBatchImportAll()).resolves.toEqual({
      outcome: "db-unavailable",
    });
    expect(openedModals).toHaveLength(0);
  });

  it("reports an empty library scope before querying any note", async () => {
    currentScope = scopeOf([], [{ type: "group", groupID: 7 }]);
    const recorded = recordCalls(["ScopeItemIDs"]);
    const { deps } = makeDeps({}, { wrap: recorded.wrap });

    await expect(importOver(deps).runBatchImportAll()).resolves.toEqual({
      outcome: "no-library-in-scope",
    });
    expect(recorded.calls).toEqual([]);
    expect(openedModals).toHaveLength(0);
  });

  it("imports every note of every library in scope, in canonical order", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    seedNotes([50]);
    seedNotes([51], { libraryID: GROUP_LIBRARY.libraryID });
    const recorded = recordCalls(["ScopeItemIDs"]);
    const { deps } = makeDeps({}, { wrap: recorded.wrap });

    const result = await importOver(deps).runBatchImportAll();

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(recorded.calls.map(({ payload }) => payload.libraryID)).toEqual([
      USER_LIBRARY_ID,
      GROUP_LIBRARY.libraryID,
    ]);
    const { manifest } = await driveLastModal();
    expect(manifest.options.tasks.map((task: FlatTask) => task.id)).toEqual([
      50, 51,
    ]);
    expect(
      manifest.options.groups.map((group: any) => group.header({ count: 1 })),
    ).toEqual([
      "My Library · Import (1)",
      "My Library · Overwrite (1)",
      "Reading group · Import (1)",
      "Reading group · Overwrite (1)",
    ]);
  });

  it("keeps action-only headings while one library contributes", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    seedNotes([50, 51]);
    const { deps } = makeDeps({});

    await importOver(deps).runBatchImportAll();

    const { manifest } = await driveLastModal();
    expect(
      manifest.options.groups.map((group: any) => group.header({ count: 2 })),
    ).toEqual(["Import (2)", "Overwrite (2)"]);
  });

  it("runs the available subset and states the unavailable library count", async () => {
    currentScope = scopeOf(
      [PERSONAL_LIBRARY],
      [
        { type: "group", groupID: 8 },
        { type: "group", groupID: 9 },
      ],
    );
    seedNotes([50, 51]);
    const { deps } = makeDeps({});

    await importOver(deps).runBatchImportAll();

    const opts = openedModals.at(-1)!;
    await driveLastModal();
    expect(opts.text.confirmIntro({ actionable: 2, notFound: 0 })).toContain(
      "2 selected libraries are unavailable.",
    );
  });

  it("routes a one-note multi-library expansion to the single-note path", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    seedNotes([51], { libraryID: GROUP_LIBRARY.libraryID });
    const { deps } = makeDeps({});

    const result = await importOver(deps).runBatchImportAll();

    expect(result).toMatchObject({ outcome: "single" });
    expect(openedModals).toHaveLength(0);
  });

  describe("exact target", () => {
    it("resolves the named group outside library scope", async () => {
      currentScope = scopeOf([PERSONAL_LIBRARY]);
      seedNotes([50, 51], { libraryID: GROUP_LIBRARY.libraryID });
      const recorded = recordCalls(["ScopeItemIDs"]);
      const { deps } = makeDeps({}, { wrap: recorded.wrap });

      const result = await importOver(deps).runBatchImportAll({
        groupID: 7,
      });

      expect(result).toEqual({ outcome: "batch-modal" });
      expect(recorded.calls).toMatchObject([
        { payload: { libraryID: GROUP_LIBRARY.libraryID } },
      ]);
    });

    it("resolves an absent library parameter to My Library", async () => {
      currentScope = scopeOf([GROUP_LIBRARY]);
      seedNotes([50, 51]);
      const recorded = recordCalls(["ScopeItemIDs"]);
      const { deps } = makeDeps({}, { wrap: recorded.wrap });

      await importOver(deps).runBatchImportAll({ groupID: 0 });

      expect(recorded.calls).toMatchObject([
        { payload: { libraryID: USER_LIBRARY_ID } },
      ]);
    });

    it("reports an unavailable group instead of a settings mismatch", async () => {
      const recorded = recordCalls(["ScopeItemIDs"]);
      const { deps } = makeDeps({}, { wrap: recorded.wrap });

      await expect(
        importOver(deps).runBatchImportAll({ groupID: 99 }),
      ).resolves.toEqual({ outcome: "unavailable-target" });
      expect(recorded.calls).toEqual([]);
      expect(openedModals).toHaveLength(0);
    });

    it("resolves a collection inside the named library only", async () => {
      seedNotes([50, 51], {
        libraryID: GROUP_LIBRARY.libraryID,
        parentItemID: null,
      });
      seedCollection(COLLECTION, GROUP_LIBRARY.libraryID, [50, 51]);
      const recorded = recordCalls(["ScopeItemIDs"]);
      const { deps } = makeDeps({}, { wrap: recorded.wrap });

      const result = await importOver(deps).runBatchImportAll({
        groupID: 7,
        collectionKey: COLLECTION,
      });

      expect(result).toEqual({ outcome: "batch-modal" });
      // One collection read, and no library-wide read.
      expect(recorded.calls).toMatchObject([
        {
          payload: {
            libraryID: GROUP_LIBRARY.libraryID,
            collectionKey: COLLECTION,
          },
        },
      ]);
    });

    it("reports an unknown collection key instead of an empty scope", async () => {
      const { deps } = makeDeps({});

      await expect(
        importOver(deps).runBatchImportAll({
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "collection-not-found" });
      expect(openedModals).toHaveLength(0);
    });

    it("reports an empty selection for a collection that holds no notes", async () => {
      seedCollection(COLLECTION, USER_LIBRARY_ID, []);
      const { deps } = makeDeps({});

      await expect(
        importOver(deps).runBatchImportAll({
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "empty-selection" });
      expect(openedModals).toHaveLength(0);
    });
  });
});

describe("runBatchImport routing", () => {
  it("returns db-unavailable when the database is closed", async () => {
    const { deps, importNote } = makeDeps({}, { dbState: "loading" });
    await expect(
      importOver(deps).runBatchImport("note", [50]),
    ).resolves.toEqual({
      outcome: "db-unavailable",
    });
    expect(importNote).not.toHaveBeenCalled();
    expect(openedModals).toHaveLength(0);
  });

  it("returns empty-selection for no ids", async () => {
    const { deps } = makeDeps({});
    await expect(importOver(deps).runBatchImport("note", [])).resolves.toEqual({
      outcome: "empty-selection",
    });
  });

  it("opens a modal for ≥2 note ids instead of importing inline", async () => {
    seedNotes([50, 51]);
    const { deps, importNote } = makeDeps({});

    const result = await importOver(deps).runBatchImport("note", [50, 51]);

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(openedModals).toHaveLength(1);
    expect(importNote).not.toHaveBeenCalled();
  });

  it("opens a modal for child mode", async () => {
    seedNotes([50]);
    const { deps } = makeDeps({});

    const result = await importOver(deps).runBatchImport("child", [
      PARENT_ITEM_ID,
    ]);

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(openedModals).toHaveLength(1);
  });
});

describe("single note import (mode=note, 1 id)", () => {
  it("imports and reports the created title without a modal", async () => {
    seedNotes([50]);
    const { deps, importNote } = makeDeps({});

    const result = await importOver(deps).runBatchImport("note", [50]);

    expect(openedModals).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(1);
    // The write reads through the Snapshot its read opened.
    expect(importNote.mock.calls[0]![1]).toMatchObject({
      reads: expect.any(Object),
    });
    expect(result).toEqual({
      outcome: "single",
      write: "created",
      title: "Note 50",
    });
    expect(batchImportNotice(result)).toBe("Imported Note 50.");
  });

  it("reports not-found when the single id does not resolve", async () => {
    const { deps, importNote } = makeDeps({});

    const result = await importOver(deps).runBatchImport("note", [99]);

    expect(result).toEqual({ outcome: "not-found", count: 1 });
    expect(importNote).not.toHaveBeenCalled();
  });

  it("confirms before overwriting an existing imported note", async () => {
    seedNotes([50]);
    confirmMock.mockResolvedValue(true);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { existing: [target], importNoteResult: "overwritten" },
    );

    const result = await importOver(deps).runBatchImport("note", [50]);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile: target });
    expect(result).toEqual({
      outcome: "single",
      write: "overwritten",
      title: "Note 50",
    });
    expect(batchImportNotice(result)).toBe("Updated imported note Note 50.");
  });

  it.effect("closes the overwrite confirm when the import is interrupted", () =>
    Effect.gen(function* () {
      seedNotes([50]);
      const { deps, importNote } = makeDeps(
        {},
        { existing: [makeFile("Imported/Note 50.md")] },
      );
      const opened = yield* Deferred.make<void>();
      const close = vi.fn();
      deps.view.confirm = () =>
        awaitModal<boolean>(() => {
          Deferred.doneUnsafe(opened, Exit.void);
          return { close };
        });

      // The single-note path opens no batch modal, so it runs nothing on the bridge.
      const bridge = stubService<BatchImportPorts["bridge"]>(
        "EffectBridge",
        {},
      );
      const importing = yield* runBatchImport(
        { ...portsOf(deps), bridge },
        { mode: "note", itemIDs: [50] },
      ).pipe(Effect.provide(layerOver(deps)), Effect.forkChild);
      yield* Deferred.await(opened);
      yield* Fiber.interrupt(importing);

      expect(close).toHaveBeenCalledOnce();
      expect(importNote).not.toHaveBeenCalled();
    }),
  );

  it("cancels when the overwrite confirm is declined", async () => {
    seedNotes([50]);
    confirmMock.mockResolvedValue(false);
    const { deps, importNote } = makeDeps(
      {},
      { existing: [makeFile("Imported/Note 50.md")] },
    );

    const result = await importOver(deps).runBatchImport("note", [50]);

    expect(result).toEqual({ outcome: "cancelled" });
    expect(importNote).not.toHaveBeenCalled();
    expect(batchImportNotice(result)).toBeUndefined();
  });
});

describe("note-mode modal classify + run", () => {
  it("keeps the single-import collector alive until the write completes", async () => {
    seedNotes([50]);
    const { deps } = makeDeps({});
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    deps.noteImport.importNote = async (_note, options) => {
      started.resolve();
      await finish.promise;
      options.reportExcerpts?.({ zotero: 1, unchecked: 0, unavailable: 0 });
      return "created";
    };
    const importing = importOver(deps).runBatchImport("note", [50]);
    await started.promise;
    expect(deps.noteFeature.reportExcerptImages).not.toHaveBeenCalled();
    finish.resolve();
    await importing;
    expect(
      deps.noteFeature.reportExcerptImages,
    ).toHaveBeenCalledExactlyOnceWith({
      zotero: 1,
      unchecked: 0,
      unavailable: 0,
    });
  });

  it("keeps admitted writes and their pooled report alive when the modal requests the stop mid-run", async () => {
    seedNotes([50, 51]);
    const { deps } = makeDeps({});
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    deps.noteImport.importNote = async (note, options) => {
      if (note.itemID === 51) return "created";
      started.resolve();
      await finish.promise;
      options.reportExcerpts?.({ zotero: 1, unchecked: 0, unavailable: 0 });
      return "created";
    };
    await importOver(deps).runBatchImport("note", [50, 51]);
    const options = openedModals.at(-1)!;
    await options.onClassify(classifyControls());
    const stop = Deferred.makeUnsafe<void>();
    const onItemSettled = vi.fn();
    const running = options.onRun({ onItemSettled, stop });
    await started.promise;
    // The modal's stop request is the only stop this run observes. The write
    // it admitted keeps running: it is neither cancelled, nor settled, nor
    // reported before it lands.
    Deferred.doneUnsafe(stop, Exit.void);
    expect(onItemSettled).not.toHaveBeenCalled();
    expect(deps.noteFeature.reportExcerptImages).not.toHaveBeenCalled();
    finish.resolve();
    expect(await running).toMatchObject({
      created: 2,
      failed: 0,
      cancelled: false,
    });
    expect(onItemSettled).toHaveBeenCalledWith({ id: 50, status: "done" });
    expect(
      deps.noteFeature.reportExcerptImages,
    ).toHaveBeenCalledExactlyOnceWith({
      zotero: 1,
      unchecked: 0,
      unavailable: 0,
    });
  });

  it("pools excerpt outcomes across completed notes when another note fails", async () => {
    seedNotes([50, 51, 52]);
    const { deps } = makeDeps({});
    deps.noteImport.importNote = async (note, options) => {
      if (note.itemID === 52) throw new Error("note write failed");
      options.reportExcerpts?.(
        note.itemID === 50
          ? { zotero: 1, unchecked: 0, unavailable: 1 }
          : { zotero: 0, unchecked: 1, unavailable: 0, notRefreshed: 1 },
      );
      return "created";
    };
    await importOver(deps).runBatchImport("note", [50, 51, 52]);
    await driveLastModal();
    expect(
      deps.noteFeature.reportExcerptImages,
    ).toHaveBeenCalledExactlyOnceWith({
      zotero: 1,
      unchecked: 1,
      unavailable: 1,
      notRefreshed: 1,
    });
  });

  it("runs every note of one import batch under one outcome scope, released after the run", async () => {
    seedNotes([50, 51, 52]);
    const { deps, importNote } = makeDeps({});
    await using probe = excerptReuseProbe();
    const scopes: (ExcerptOutcomeScope | undefined)[] = [];
    // Each note resolves the probe's excerpt in turn, so only the run's own
    // retention — not a shared in-flight request — can answer the repeats.
    let resolutions: Promise<unknown> = Promise.resolve();
    importNote.mockImplementation(async (_note, options) => {
      scopes.push(options.outcomes);
      resolutions = resolutions.then(() => probe.resolve(options.outcomes));
      await resolutions;
      return "created" as const;
    });

    await importOver(deps).runBatchImport("note", [50, 51, 52]);
    await driveLastModal();

    // One run is one batch: every note resolves through one scope, and the
    // repeats reuse the outcome the first note produced.
    expect(scopes).toHaveLength(3);
    expect(scopes[1]).toBe(scopes[0]);
    expect(scopes[2]).toBe(scopes[0]);
    expect(probe.renders()).toBe(1);
    // Every note settled, so the run released what it retained: a later note
    // driven through the same scope renders again.
    await probe.resolve(scopes[0]);
    expect(probe.renders()).toBe(2);
  });

  it("threads the run's Snapshot reads to every imported note", async () => {
    seedNotes([50, 51]);
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("note", [50, 51]);
    await driveLastModal();

    expect(importNote).toHaveBeenCalledTimes(2);
    // Both writes read one Snapshot, held for the run.
    const reads = importNote.mock.calls[0]![1].reads;
    expect(reads).toEqual(expect.any(Object));
    for (const call of importNote.mock.calls) {
      expect(call[1].reads).toBe(reads);
    }
  });

  it("dedupes itemIDs so one note never mints two mirrors", async () => {
    seedNotes([50]);
    const recorded = recordCalls(["NoteRefs"]);
    const { deps, importNote } = makeDeps({}, { wrap: recorded.wrap });

    await importOver(deps).runBatchImport("note", [50, 50]);
    const { manifest } = await driveLastModal();

    expect(recorded.calls[0]!.payload.itemIDs).toEqual([50]);
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("buckets unresolved ids as not-found while importing the rest", async () => {
    seedNotes([50]);
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("note", [50, 99]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.notFound).toHaveLength(1);
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("labels a trashed note distinctly from a genuine non-note id", async () => {
    seedNotes([50]);
    // 60 is a note that's in Zotero's trash; 99 isn't a note at all.
    seedNotes([60]);
    db.$client.exec("insert into deletedItems (itemID) values (60)");
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("note", [50, 60, 99]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.notFound).toEqual(
      expect.arrayContaining([
        { itemID: 60, label: "Item 60 (in trash)" },
        { itemID: 99, label: "Item 99 (not a note)" },
      ]),
    );
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("classifies an existing mirror as an overwrite with its target file", async () => {
    seedNotes([50]);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { existing: [target], importNoteResult: "overwritten" },
    );

    await importOver(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "1:overwrite" });
    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile: target });
  });

  it("settles a vanished note as skipped, not failed", async () => {
    seedNotes([50]);
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("note", [50, 51]);
    const options = openedModals.at(-1)!;
    await options.onClassify(classifyControls());
    // The note leaves Zotero between classify and the write.
    db.$client.exec(
      "delete from itemNotes where itemID = 50; delete from items where itemID = 50",
    );
    const onItemSettled = vi.fn();
    await options.onRun({
      onItemSettled,
      stop: Deferred.makeUnsafe<void>(),
    });

    expect(importNote).not.toHaveBeenCalled();
    expect(onItemSettled).toHaveBeenCalledWith({ id: 50, status: "skipped" });
  });
});

describe("up-to-date classification", () => {
  it("classifies a note as up-to-date when zotero-lastmod matches", async () => {
    const ref50 = makeRef(50);
    seedNotes([50, 51]);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      {
        frontmatter: new Map([
          [target, { "zotero-lastmod": "2024-02-03T08:30:00Z" }],
        ]),
      },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await importOver(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks).toHaveLength(1);
    expect(manifest.options.tasks[0]).toMatchObject({ kind: "1:create" });
    expect(manifest.options.upToDate).toHaveLength(1);
    expect(manifest.options.upToDate[0]).toMatchObject({ label: "Note 50" });
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("classifies as overwrite when zotero-lastmod is missing (self-healing)", async () => {
    const ref50 = makeRef(50);
    seedNotes([50, 51]);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { importNoteResult: "overwritten" },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await importOver(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "1:overwrite" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("classifies as overwrite when zotero-lastmod is older than dateModified", async () => {
    const ref50 = makeRef(50);
    seedNotes([50, 51]);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      {
        importNoteResult: "overwritten",
        frontmatter: new Map([
          [target, { "zotero-lastmod": "2024-02-03T08:29:00Z" }],
        ]),
      },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await importOver(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "1:overwrite" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("classifies as create when no existing file exists", async () => {
    seedNotes([50, 51]);
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks).toHaveLength(2);
    expect(manifest.options.tasks[0]).toMatchObject({ kind: "1:create" });
    expect(manifest.options.tasks[1]).toMatchObject({ kind: "1:create" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });
});

describe("child-mode modal classify", () => {
  it("groups child notes under their parent display ref", async () => {
    seedNotes([50, 51]);
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("child", [PARENT_ITEM_ID]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.parents).toHaveLength(1);
    expect(manifest.options.parents[0]).toMatchObject({
      label: "Parent paper",
    });
    expect(manifest.options.parents[0].children).toHaveLength(2);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("builds an empty tree when no child notes exist", async () => {
    const { deps, importNote } = makeDeps({});

    await importOver(deps).runBatchImport("child", [PARENT_ITEM_ID]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.parents).toHaveLength(0);
    expect(importNote).not.toHaveBeenCalled();
  });
});

describe("runChildImportByKey", () => {
  it("reports database unavailable instead of not found", async () => {
    const { deps } = makeDeps({}, { dbState: "loading" });

    await expect(
      importOver(deps).runChildImportByKey(formatIndexedKey("ABCD2345", null)),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns null when the indexed key does not resolve to an item", async () => {
    const { deps } = makeDeps({});

    await expect(
      importOver(deps).runChildImportByKey(formatIndexedKey("MISSING1", null)),
    ).resolves.toBeNull();
  });

  it("opens the child-import modal when the key resolves", async () => {
    db.$client.exec(`
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values (7, 1, '2024-01-01 10:00:00', '2024-01-01 10:00:00', 1, 'ABCD2345');
    `);
    seedNotes([50], { parentItemID: 7 });
    const { deps, importNote } = makeDeps({});

    const result = await importOver(deps).runChildImportByKey(
      formatIndexedKey("ABCD2345", null),
    );

    expect(result).toEqual({ outcome: "batch-modal" });
    await driveLastModal();
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("returns a rejected promise when synchronous key lookup throws", async () => {
    // A read that fails inside SQLite answers with a tagged DbUnavailable.
    const { deps } = makeDeps(
      {},
      {
        wrap: (client) => ({
          ...client,
          ItemsByIndexedKeys: (() =>
            Effect.fail(
              new DbUnavailable({ message: "sqlite read failed" }),
            )) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
        }),
      },
    );

    await expect(
      importOver(deps).runChildImportByKey(formatIndexedKey("ABCD2345", null)),
    ).rejects.toThrow("sqlite read failed");
  });

  it("maps unresolved keys through the child-import toast", () => {
    expect(childImportToast().success(null)).toBe("Zotero item not found.");
    expect(childImportToast().success({ outcome: "db-unavailable" })).toBe(
      "Open the Zotero database to update notes.",
    );
  });

  it("surfaces Profile recovery through the single-import toast", () => {
    const error = batchImportToast().error;
    expect(error).toBeTypeOf("function");
    expect(
      Reflect.apply(error as (...args: unknown[]) => string, null, [
        "fallback",
        NoteImportProfileError.unknown("missing-profile", {
          path: "Imported/Methods.md",
        }),
      ]),
    ).toBe(
      m.notice_imported_note_profile_unknown({
        stamp: "missing-profile",
        target: "Imported/Methods.md",
      }),
    );
  });

  it("surfaces a missing Profile document through the single-import toast", () => {
    const error = batchImportToast().error;
    expect(
      Reflect.apply(error as (...args: unknown[]) => string, null, [
        "fallback",
        new ProfileAnnotationError({
          code: "missing-literature-note-template",
          document: "missing.md",
          hint: "Restore the document.",
        }),
      ]),
    ).toContain("missing.md");
  });
});

describe("reimportNoteByKey", () => {
  it("reports retained images once for the explicit re-import", async () => {
    const note = makeIndexedNote();
    seedNotes([note.itemID], { key: note.key });
    const { deps } = makeDeps({});
    deps.noteImport.importNote = async (_note, options) => {
      options.reportExcerpts?.({
        zotero: 0,
        unchecked: 0,
        unavailable: 0,
        notRefreshed: 2,
      });
      return "overwritten";
    };
    await importOver(deps).reimportNoteByKey(
      note.indexedKey,
      makeFile("Imported/Clicked.md"),
    );
    expect(
      deps.noteFeature.reportExcerptImages,
    ).toHaveBeenCalledExactlyOnceWith({
      zotero: 0,
      unchecked: 0,
      unavailable: 0,
      notRefreshed: 2,
    });
  });

  it("reports database unavailable instead of not found", async () => {
    const { deps } = makeDeps({}, { dbState: "loading" });

    await expect(
      importOver(deps).reimportNoteByKey(
        formatIndexedKey("ABCD2345", null),
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns not-found when the note key does not resolve", async () => {
    const { deps } = makeDeps({});

    await expect(
      importOver(deps).reimportNoteByKey(
        formatIndexedKey("GONE1234", null),
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "not-found" });
  });

  it("passes the clicked file as the overwrite target", async () => {
    const note = makeIndexedNote();
    const targetFile = makeFile("Imported/Clicked.md");
    seedNotes([note.itemID], { key: note.key });
    const { deps, importNote } = makeDeps(
      {},
      { importNoteResult: "overwritten" },
    );

    await expect(
      importOver(deps).reimportNoteByKey(note.indexedKey, targetFile),
    ).resolves.toEqual({ outcome: "overwritten" });

    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile });
  });
});
