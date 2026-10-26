import { it } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { beforeEach, describe, expect, vi } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Item, Library } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { MemoryFileManager } from "@/lib/__fixtures__/obsidian-file-manager";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { scopedBridge } from "@/lib/effect-bridge";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import type { AttachmentImportBatch } from "@/services/attachment-import/service";
import { excerptReuseProbe } from "@/services/excerpt-image/__fixtures__/reuse";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type {
  AvailableLibrary,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorOf } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { batchUpdateNotices } from "@/services/note-feature/update-single";
import type { NoteImportView } from "@/services/note-import/view";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { InertTemplateError } from "@/services/template/errors";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
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
  BatchModalOptions,
  BatchProfileChoice,
  FlatGroupDef,
} from "@/views/batch-modal";

import { noteFeatureServices } from "./__fixtures__/note-feature";
import type { NoteFeatureSources } from "./__fixtures__/note-feature";
import type {
  PlannedCreation,
  PlannedCreationProfile,
} from "./creation-planning";
import { NoteWriteAborted } from "./errors";
import type {
  CreateNoteOptions,
  CreateNoteResult,
  CreationProfileSelection,
  UpdateResult,
} from "./operations";
import { layerNoteFeature, NoteFeature } from "./service";
import {
  batchCreateOutcome,
  BatchCreateRefusedError,
  runBatchUpdate as runBatchUpdateEffect,
  runBatchUpdateAll as runBatchUpdateAllEffect,
} from "./update-batch";
import type {
  BatchUpdateOptions,
  BatchUpdatePorts,
  BatchUpdateResult,
  BatchUpdateServices,
} from "./update-batch";

/** Captured options of every batch modal the runner opened via its view port. */
const openedModals: BatchModalOptions[] = [];
/** The Profile picker's answer when the user closes it. */
const noProfile: ProfileSelector | undefined = undefined;
const pickerClosed = Effect.succeed(noProfile);
/** The view port's Profile picker; controlled per Profile-choice test. */
const chooseProfile = vi.fn<NoteImportView["chooseProfile"]>();

// Stub only the DOM-bound manifest so classify/run drive the real batch-run
// mechanics headlessly; classification runs inside the modal, which never
// opens here.
vi.mock("@/views/batch-modal", () => {
  class FlatManifest {
    constructor(readonly options: any) {}
    get counts() {
      return {
        actionable: this.options.tasks.length,
        notFound: this.options.notFound.length,
      };
    }
  }
  return { FlatManifest };
});

const COLLECTION = "ABCD2345";

const PERSONAL_LIBRARY: Library = {
  libraryID: USER_LIBRARY_ID,
  version: 0,
  clientVersion: null,
  type: "user",
  groupID: null,
  name: null,
};

/** A group whose local id sorts before the personal library's own row order. */
const GROUP_LIBRARY: Library = {
  libraryID: 12,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

function available(library: Library): AvailableLibrary {
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
    available: libraries.map(available),
    unavailable,
  };
}

let currentScope: ResolvedLibraryScope = scopeOf([PERSONAL_LIBRARY]);

/**
 * Answers `ItemsByIndexedKeys` at the interface: every key `ITEM<n>`, or
 * `ITEM<n>g<groupID>`, names item `n`. The item shape stays partial, as the stubbed note writes need.
 */
function itemsAtInterface(client: ZoteroReadsClient): ZoteroReadsClient {
  return {
    ...client,
    ItemsByIndexedKeys: (({ indexedKeys }: { indexedKeys: string[] }) =>
      Effect.succeed(
        new Map(
          indexedKeys.map((indexedKey) => [
            indexedKey,
            {
              itemID: Number.parseInt(indexedKey.slice(4)),
              indexedKey,
            } as Item,
          ]),
        ),
      )) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
  };
}

function creationPlans(
  indexedKeys: readonly string[],
  planFor: (item: Item) => Omit<PlannedCreation, "item">,
): ReadonlyMap<string, PlannedCreation> {
  return new Map(
    indexedKeys.map((indexedKey) => {
      const item = {
        indexedKey,
        itemID: Number.parseInt(indexedKey.slice(4)),
      } as Item;
      return [indexedKey, { item, ...planFor(item) }];
    }),
  );
}

/**
 * The Zotero database each case seeds: My Library, the Reading group's
 * library 12, and an empty collection `COLLECTION` in My Library.
 */
let db: NodeDatabaseClient;

function seedDatabase(): NodeDatabaseClient {
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values
      (${USER_LIBRARY_ID}, 'user'), (${GROUP_LIBRARY.libraryID}, 'group');
    insert into groups (groupID, libraryID, name) values
      (${GROUP_LIBRARY.groupID}, ${GROUP_LIBRARY.libraryID}, '${GROUP_LIBRARY.name}');
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName) values (1, 'title');
    insert into collections (collectionID, collectionName, libraryID, key)
      values (100, 'Reading list', ${USER_LIBRARY_ID}, '${COLLECTION}');
  `);
  return client;
}

/**
 * Live items `ITEM<n>` titled `Item <n>`, each in its library. A lower id
 * is modified later, so a library lists its items in ascending id order.
 */
function itemsIn(byLibrary: ReadonlyMap<number, number>): void {
  for (const [itemID, libraryID] of byLibrary) {
    const modified = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe("2024-01-01T00:00:00Z"), {
        minutes: 1000 - itemID,
      }),
    )
      .replace("T", " ")
      .slice(0, 19);
    db.$client.exec(`
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values (${itemID}, 1, '${modified}', '${modified}', ${libraryID}, 'ITEM${itemID}');
      insert into itemDataValues (valueID, value) values (${itemID}, 'Item ${itemID}');
      insert into itemData (itemID, fieldID, valueID) values (${itemID}, 1, ${itemID});
    `);
  }
}

/** Put items in the collection `COLLECTION` of `libraryID`, creating it there. */
function collectionHolds(libraryID: number, itemIDs: readonly number[]): void {
  db.$client.exec(`
    delete from collections where libraryID = ${libraryID};
    insert into collections (collectionID, collectionName, libraryID, key)
      values (200, 'Shared', ${libraryID}, '${COLLECTION}');
    ${itemIDs.map((id) => `insert into collectionItems (collectionID, itemID) values (200, ${id});`).join("\n")}
  `);
}

/** {@link db} and the read services the current case opened over it. */
let caseResources: AsyncDisposableStack;

/**
 * The values a case sets: the plugin services' answers, which the runtime
 * reads from here at the time of each call, and Note Feature's note writes.
 */
interface UpdateDeps {
  profile: ProfileReader;
  zoteroReads: TestReads;
  dbState: ZoteroReadsState["state"];
  /** The Snapshot the runners open; the case's reads by default. */
  snapshot: ZoteroReads["Service"]["snapshot"];
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  /** The Note Feature members the runners call; a case may replace one. */
  noteFeature: Pick<
    NoteFeature["Service"],
    | "reportExcerptImages"
    | "createNote"
    | "updateNote"
    | "writeNoteUpdate"
    | "planCreations"
  >;
  noteIndex: {
    whenIndexed(): Promise<void>;
    getNotesByItemKey(indexedKey: string): TFile[];
  };
  /** The plugin services the runners read, answering from these values. */
  layer: Layer.Layer<BatchUpdateServices>;
}

function makeDeps(
  dbState: "loading" | "ready" = "ready",
  wrap: (client: ZoteroReadsClient) => ZoteroReadsClient = (client) => client,
  noteFeature?: (deps: UpdateDeps) => Layer.Layer<NoteFeature>,
): UpdateDeps {
  const zoteroReads = caseResources.use(
    inProcessReadsService(sharedClientOpener(db), {
      wrap: (reads) => wrap(itemsAtInterface(reads)),
    }),
  );
  const deps: UpdateDeps = {
    profile: profileReader(),
    zoteroReads,
    dbState,
    snapshot: zoteroReads.snapshot,
    settings: {
      current: Effect.succeed(defaults),
      update: () => Effect.succeed(defaults),
    },
    noteFeature: stubService<UpdateDeps["noteFeature"]>("NoteFeature", {
      reportExcerptImages: vi.fn(() => Effect.void),
      planCreations: (keys) =>
        Effect.succeed(
          creationPlans(keys, () => ({
            selection: {
              selector: "default",
              source: "bound",
              shouldAsk: false,
            },
            previews: [],
          })),
        ),
    }),
    noteIndex: {
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
    layer: Layer.mergeAll(
      Layer.mock(LibraryScope, {
        resolveLibraries: () => Effect.sync(() => currentScope),
      }),
      noteFeature
        ? Layer.suspend(() => noteFeature(deps))
        : // Each call reads the member as it is then, so a case may replace a
          // member after the layer is built.
          Layer.mock(NoteFeature, {
            reportExcerptImages: (summary) =>
              deps.noteFeature.reportExcerptImages(summary),
            createNote: (item, options) =>
              deps.noteFeature.createNote(item, options),
            updateNote: (file, options) =>
              deps.noteFeature.updateNote(file, options),
            writeNoteUpdate: (file, options) =>
              deps.noteFeature.writeNoteUpdate(file, options),
            planCreations: (indexedKeys, sources) =>
              deps.noteFeature.planCreations(indexedKeys, sources),
          }),
      // Only the one-item path reads them, and no case here reaches it.
      Layer.mock(MetadataCache, {}),
      Layer.mock(Workspace, {}),
      Layer.mock(NoteIndex, {
        whenIndexed: Effect.promise(() => deps.noteIndex.whenIndexed()),
        getNotesByItemKey: (indexedKey) =>
          Effect.sync(() => deps.noteIndex.getNotesByItemKey(indexedKey)),
      }),
      testNotifier().layer,
      Layer.mock(PluginSettings, {
        current: Effect.suspend(() => deps.settings.current),
        update: (patch) => deps.settings.update(patch),
      }),
      Layer.mock(Profile, {
        profiles: Effect.sync(() => deps.profile.profiles),
        resolveProfile: (selector) =>
          Effect.sync(() => deps.profile.resolveProfile(selector)),
        profileOf: (file) => Effect.sync(() => deps.profile.profileOf(file)),
      }),
      // Only the real Profile picker reads it; the fake view does not.
      Layer.mock(ZoteroPref, {}),
      Layer.mock(ZoteroReads, {
        current: Effect.sync(() =>
          stubService<ZoteroReadsState>("ZoteroReadsState", {
            state: deps.dbState,
          }),
        ),
        reads: zoteroReads.reads,
        snapshot: Effect.suspend(() => deps.snapshot),
      }),
    ),
  };
  return deps;
}

/**
 * The ports a case's runs take: the view port fakes, and `bridge` for the
 * modal's callbacks.
 */
function portsOf(
  deps: UpdateDeps,
  bridge: BatchUpdatePorts["bridge"],
): BatchUpdatePorts {
  return {
    notices: batchUpdateNotices(stubService<App>("App", {})),
    bridge,
    view: {
      openBatchModal: (options) => {
        openedModals.push(options);
      },
      chooseProfile,
    },
  };
}

/**
 * {@link runBatchUpdateEffect} on the case's services. The modal's callbacks
 * run through a bridge over the case's Scope, so the case's end, or `bridge`
 * when given, is the unload.
 */
const runBatchUpdate = Effect.fnUntraced(function* (
  deps: UpdateDeps,
  itemIDs: readonly number[],
  {
    bridge,
    ...options
  }: BatchUpdateOptions & { readonly bridge?: BatchUpdatePorts["bridge"] } = {},
) {
  return yield* runBatchUpdateEffect(
    portsOf(deps, bridge ?? (yield* scopedBridge)),
    itemIDs,
    options,
  ).pipe(Effect.provide(deps.layer));
});

/** {@link runBatchUpdateAllEffect} on the case's services. */
const runBatchUpdateAll = Effect.fnUntraced(function* (
  deps: UpdateDeps,
  target?: Parameters<typeof runBatchUpdateAllEffect>[1],
) {
  return yield* runBatchUpdateAllEffect(
    portsOf(deps, yield* scopedBridge),
    target,
  ).pipe(Effect.provide(deps.layer));
});

/** Drive the last opened modal's loading phase and return its manifest options. */
async function classifyLastModal(): Promise<{
  tasks: { id: number; kind: string }[];
  groups: FlatGroupDef[];
  intro: string;
}> {
  const opts = openedModals.at(-1);
  if (!opts) throw new Error("no modal was opened");
  const manifest = (await opts.onClassify({
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  })) as unknown as { options: any };
  return {
    tasks: manifest.options.tasks,
    groups: manifest.options.groups,
    intro: opts.text.confirmIntro({
      actionable: manifest.options.tasks.length,
      notFound: manifest.options.notFound.length,
    }),
  };
}

beforeEach(() => {
  openedModals.length = 0;
  chooseProfile.mockReset();
  currentScope = scopeOf([PERSONAL_LIBRARY]);
  caseResources = new AsyncDisposableStack();
  db = caseResources.adopt(seedDatabase(), (client) => client.$client.close());
  return () => caseResources.disposeAsync();
});

/** The libraries (and collection keys) a run's scope read asked for. */
function scopeReads() {
  const recorded = recordCalls(["ScopeItemIDs"]);
  return {
    wrap: recorded.wrap,
    asked: () =>
      recorded.calls.map(({ payload }) =>
        payload["collectionKey"] === undefined
          ? payload["libraryID"]
          : {
              libraryID: payload["libraryID"],
              collectionKey: payload["collectionKey"],
            },
      ),
  };
}

/**
 * A client whose DisplayRefs stream sends its first slice and then waits until
 * it is interrupted, which `onInterrupt` hears.
 */
function stallAfterFirstSlice(onInterrupt: () => void) {
  return (client: ZoteroReadsClient): ZoteroReadsClient => ({
    ...client,
    DisplayRefs: ((payload: object, options?: object) =>
      Stream.concat(
        (
          client.DisplayRefs as unknown as (
            payload: object,
            options?: object,
          ) => Stream.Stream<unknown>
        )(payload, options),
        Stream.never,
      ).pipe(
        Stream.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.hasInterrupts(exit)) onInterrupt();
          }),
        ),
      )) as unknown as ZoteroReadsClient["DisplayRefs"],
  });
}

describe("classify through the DisplayRefs stream", () => {
  it.effect(
    "classifies bounded requests under one Snapshot and writes each item under the run's Snapshot",
    () =>
      Effect.gen(function* () {
        const recorded = recordCalls(["DisplayRefs", "ItemsByIndexedKeys"]);
        const deps = makeDeps("ready", recorded.wrap);
        deps.noteFeature.createNote = (item, options) =>
          Effect.gen(function* () {
            // The create renders through the reads it was handed.
            yield* options!.reads!.ItemsByIndexedKeys({
              indexedKeys: [item.indexedKey],
            });
            return {
              outcome: "created",
              file: noteAt("Literature/New.md"),
            } satisfies CreateNoteResult;
          }).pipe(Effect.orDie);
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        const progress: number[] = [];

        const itemIDs = Array.from({ length: 1001 }, (_, index) => index + 1);
        yield* runBatchUpdate(deps, itemIDs);
        const modal = openedModals.at(-1)!;
        yield* Effect.promise(() =>
          modal.onClassify({
            onProgress: (classified) => progress.push(classified),
            signal: new AbortController().signal,
          }),
        );
        const result = yield* Effect.promise(() =>
          modal.onRun({
            onItemSettled: vi.fn(),
            stop: Deferred.makeUnsafe<void>(),
          }),
        );

        expect(result).toMatchObject({ created: 2, failed: 0 });
        expect(progress).toEqual([500, 1000, 1001]);
        const classify = recorded.calls.slice(0, 3);
        const loads = recorded.calls.slice(3);
        expect(classify.map(({ operation }) => operation)).toEqual(
          Array(3).fill("DisplayRefs"),
        );
        expect(classify.map(({ payload }) => payload.itemIDs)).toEqual([
          itemIDs.slice(0, 500),
          itemIDs.slice(500, 1000),
          itemIDs.slice(1000),
        ]);
        // Two item loads and the two creates' reads.
        expect(loads.map(({ operation }) => operation)).toEqual(
          Array(4).fill("ItemsByIndexedKeys"),
        );
        // Classify reads its own Snapshot; the run's loads and creates share another.
        const [classifySnapshot, runSnapshot] = recorded.snapshots;
        for (const request of classify)
          expect(request.payload.snapshot).toBe(classifySnapshot);
        for (const load of loads)
          expect(load.payload.snapshot).toBe(runSnapshot);
        expect(runSnapshot).not.toBe(classifySnapshot);
      }),
  );

  it.effect(
    "interrupts the DisplayRefs stream when Cancel lands during classify",
    () =>
      Effect.gen(function* () {
        let interrupted = false;
        const deps = makeDeps(
          "ready",
          stallAfterFirstSlice(() => {
            interrupted = true;
          }),
        );
        itemsIn(new Map([[1, USER_LIBRARY_ID]]));
        const abort = new AbortController();

        yield* runBatchUpdate(deps, [1, 2]);
        const classified = openedModals.at(-1)!.onClassify({
          onProgress: () => abort.abort(),
          signal: abort.signal,
        });

        yield* Effect.promise(() => expect(classified).rejects.toThrow());
        expect(interrupted).toBe(true);
      }),
  );

  it.effect(
    "interrupts the DisplayRefs stream when unload lands during classify",
    () =>
      Effect.gen(function* () {
        let interrupted = false;
        const deps = makeDeps(
          "ready",
          stallAfterFirstSlice(() => {
            interrupted = true;
          }),
        );
        itemsIn(new Map([[1, USER_LIBRARY_ID]]));
        const unload = yield* Scope.make();
        const bridge = yield* scopedBridge.pipe(Scope.provide(unload));
        const sliced = Promise.withResolvers<void>();

        yield* runBatchUpdate(deps, [1, 2], { bridge });
        const classified = openedModals.at(-1)!.onClassify({
          onProgress: () => sliced.resolve(),
          signal: yield* Effect.abortSignal,
        });
        yield* Effect.promise(() => sliced.promise);
        yield* Scope.close(unload, Exit.void);
        yield* Effect.promise(() => classified.catch(() => undefined));

        expect(interrupted).toBe(true);
      }),
  );

  it.effect(
    "interrupts the creation plan when Cancel lands while it runs",
    () =>
      Effect.gen(function* () {
        const deps = makeDeps("ready");
        // An additional Profile makes classify plan the new rows.
        deps.profile = profileReader({
          ...defaults,
          profiles: [{ id: BOOKS, label: "Books" }],
        });
        const planning = yield* Deferred.make<void>();
        let interrupted = false;
        deps.noteFeature.planCreations = () =>
          Deferred.succeed(planning, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          );
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        // Closing `cancel` aborts the signal, as the modal's Cancel does.
        const cancel = yield* Scope.make();
        const signal = yield* Effect.abortSignal.pipe(Scope.provide(cancel));

        yield* runBatchUpdate(deps, [1, 2]);
        const classified = openedModals.at(-1)!.onClassify({
          onProgress: vi.fn(),
          signal,
        });
        yield* Deferred.await(planning);
        yield* Scope.close(cancel, Exit.void);

        yield* Effect.promise(() => expect(classified).rejects.toThrow());
        expect(interrupted).toBe(true);
      }),
  );
});

describe("a write that rejects", () => {
  it.effect(
    "halts the run on an inert template, without a failure row, and shows the template's message",
    () =>
      Effect.gen(function* () {
        const deps = makeDeps("ready");
        const inert = new InertTemplateError("Inert message");
        deps.noteFeature.createNote = () => Effect.fail(inert);
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        const onItemSettled = vi.fn();

        yield* runBatchUpdate(deps, [1, 2]);
        const modal = openedModals.at(-1)!;
        yield* Effect.promise(() =>
          modal.onClassify({
            onProgress: vi.fn(),
            signal: new AbortController().signal,
          }),
        );
        const run = modal.onRun({
          onItemSettled,
          stop: Deferred.makeUnsafe<void>(),
        });

        const error: unknown = yield* Effect.promise(() =>
          run.then(
            () => expect.unreachable("the run halts"),
            (reason: unknown) => reason,
          ),
        );
        expect(error).toBe(inert);
        expect(onItemSettled).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: "failed" }),
        );
        const { runFailed } = modal.text;
        expect(
          typeof runFailed === "function" ? runFailed(error) : runFailed,
        ).toBe("Inert message");
      }),
  );

  it.effect(
    "halts the run when the Note Feature's own render meets an inert template",
    () =>
      Effect.gen(function* () {
        const inert = new InertTemplateError("Inert message");
        const deps = makeDeps("ready", undefined, (deps) => {
          const host = createObsidianHost();
          const sources = stubService<NoteFeatureSources>(
            "NoteFeatureSources",
            {
              get profile() {
                return deps.profile;
              },
              noteIndex: {
                whenIndexed: () => deps.noteIndex.whenIndexed(),
                getNotesByItemKey: (key) =>
                  deps.noteIndex.getNotesByItemKey(key),
                getImportedNoteByNoteKey: () => [],
              },
              zoteroReads: {
                reads: deps.zoteroReads.reads,
                snapshot: deps.zoteroReads.snapshot,
              },
              template: stubService<NoteFeatureSources["template"]>(
                "Template",
                {
                  renderFilename: () => "New",
                  frontmatterFields: [],
                  render: () => {
                    throw inert;
                  },
                },
              ),
              app: { ...host.app, fileManager: new MemoryFileManager() },
              get settings() {
                return deps.settings;
              },
              zoteroPref: { dataDir: "", baseAttachmentPath: null },
              attachmentImport: {
                prepare: () =>
                  Effect.succeed(
                    stubService<AttachmentImportBatch>("AttachmentBatch", {
                      // The render stops the create before any attachment.
                      decide: () => {
                        throw new Error("This case copies no attachment.");
                      },
                      resolveLink: () => () => "",
                      discard: Effect.void,
                    }),
                  ),
              },
            },
          );
          return layerNoteFeature.pipe(
            Layer.provide(noteFeatureServices(sources)),
          );
        });
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        const onItemSettled = vi.fn();

        yield* runBatchUpdate(deps, [1, 2]);
        const modal = openedModals.at(-1)!;
        yield* Effect.promise(() =>
          modal.onClassify({
            onProgress: vi.fn(),
            signal: new AbortController().signal,
          }),
        );
        const run = modal.onRun({
          onItemSettled,
          stop: Deferred.makeUnsafe<void>(),
        });

        const error: unknown = yield* Effect.promise(() =>
          run.then(
            () => expect.unreachable("the run halts"),
            (reason: unknown) => reason,
          ),
        );
        // The refusal stays a typed failure across the write pipeline.
        expect(error).toBe(inert);
        expect(error).toMatchObject({ _tag: "InertTemplateError" });
        expect(onItemSettled).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: "failed" }),
        );
        const { runFailed } = modal.text;
        expect(
          typeof runFailed === "function" ? runFailed(error) : runFailed,
        ).toBe("Inert message");
      }),
  );

  it.effect(
    "reports any other rejection as the row's failure, with its message",
    () =>
      Effect.gen(function* () {
        const deps = makeDeps("ready");
        deps.noteFeature.createNote = () =>
          Effect.fail(
            new NoteWriteAborted({ path: "", cause: new Error("disk full") }),
          );
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        const onItemSettled = vi.fn();

        yield* runBatchUpdate(deps, [1, 2]);
        const modal = openedModals.at(-1)!;
        yield* Effect.promise(() =>
          modal.onClassify({
            onProgress: vi.fn(),
            signal: new AbortController().signal,
          }),
        );
        const result = yield* Effect.promise(() =>
          modal.onRun({
            onItemSettled,
            stop: Deferred.makeUnsafe<void>(),
          }),
        );

        expect(result).toMatchObject({ failed: 2 });
        expect(onItemSettled).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "failed",
            failure: expect.objectContaining({ message: "disk full" }),
          }),
        );
      }),
  );
});

describe("the run's Snapshot", () => {
  /** Record in `events` each open and close of a Snapshot that `deps` hands out. */
  function trackSnapshots(deps: UpdateDeps, events: string[]): void {
    deps.snapshot = deps.zoteroReads.snapshot.pipe(
      Effect.tap(() => Effect.sync(() => events.push("open"))),
      Effect.tap(() =>
        Effect.addFinalizer(() => Effect.sync(() => events.push("close"))),
      ),
    );
  }

  /**
   * Classify items 1 and 2 in the opened modal, then start its run in a fiber
   * that succeeds with how the run settled.
   */
  const classifyAndRun = Effect.fnUntraced(function* (deps: UpdateDeps) {
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [2, USER_LIBRARY_ID],
      ]),
    );
    yield* runBatchUpdate(deps, [1, 2]);
    const modal = openedModals.at(-1)!;
    const signal = yield* Effect.abortSignal;
    yield* Effect.promise(() =>
      modal.onClassify({ onProgress: vi.fn(), signal }),
    );
    return yield* Effect.promise(() =>
      modal
        .onRun({
          onItemSettled: vi.fn(),
          stop: Deferred.makeUnsafe<void>(),
        })
        .then(
          () => ({ rejected: false, reason: undefined }),
          (reason: unknown) => ({ rejected: true, reason }),
        ),
    ).pipe(Effect.forkChild);
  });

  it.effect("holds the Snapshot until every write settles", () =>
    Effect.gen(function* () {
      const deps = makeDeps("ready");
      const events: string[] = [];
      trackSnapshots(deps, events);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let writes = 0;
      deps.noteFeature.createNote = () =>
        Effect.gen(function* () {
          writes++;
          if (writes === 2) yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          events.push("write settled");
          return {
            outcome: "created",
            file: noteAt("Literature/New.md"),
          } satisfies CreateNoteResult;
        });

      const run = yield* classifyAndRun(deps);
      yield* Deferred.await(started);
      // Classify closed its own Snapshot; the run's stays open.
      expect(events).toEqual(["open", "close", "open"]);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(run)).toMatchObject({ rejected: false });

      expect(events).toEqual([
        "open",
        "close",
        "open",
        "write settled",
        "write settled",
        "close",
      ]);
    }),
  );

  it.effect("closes the Snapshot when the run fails", () =>
    Effect.gen(function* () {
      const deps = makeDeps("ready");
      const events: string[] = [];
      trackSnapshots(deps, events);
      deps.noteFeature.createNote = () =>
        Effect.fail(new InertTemplateError("Inert message"));

      const run = yield* classifyAndRun(deps);
      expect(yield* Fiber.join(run)).toMatchObject({
        rejected: true,
        reason: { _tag: "InertTemplateError" },
      });
      expect(events).toEqual(["open", "close", "open", "close"]);
    }),
  );

  it.effect(
    "rejects the run with the failure that opening its Snapshot met",
    () =>
      Effect.gen(function* () {
        const deps = makeDeps("ready");
        const failure = new DbUnavailable({ message: "The database closed." });
        let opens = 0;
        deps.snapshot = Effect.suspend(() => {
          opens++;
          return opens === 1 ? deps.zoteroReads.snapshot : Effect.fail(failure);
        });
        const createNote = vi.fn<NoteFeature["Service"]["createNote"]>();
        deps.noteFeature.createNote = createNote;

        const run = yield* classifyAndRun(deps);
        expect(yield* Fiber.join(run)).toEqual({
          rejected: true,
          reason: failure,
        });

        expect(createNote).not.toHaveBeenCalled();
      }),
  );
});

describe("batchCreateOutcome", () => {
  it.effect(
    "preserves a create refusal as a failed-row error with its diagnostic",
    () =>
      Effect.gen(function* () {
        const refusal: Extract<CreateNoteResult, { outcome: "refused" }> = {
          outcome: "refused",
          diagnostic: {
            code: "duplicate-literature-notes",
            hint: "Resolve the duplicate Literature Notes, then run create again.",
            indexedKey: "ABCD1234",
            paths: ["Literature/Newer.md", "Archive/Older.md"],
          },
        };

        const error = yield* Effect.flip(batchCreateOutcome(refusal));

        expect(error).toBeInstanceOf(BatchCreateRefusedError);
        expect(error).toMatchObject({
          _tag: "BatchCreateRefusedError",
          message:
            "Multiple literature notes use this Zotero key: Literature/Newer.md, Archive/Older.md; resolve the duplicates before you create another note.",
          diagnostic: refusal.diagnostic,
        });
      }),
  );
});

describe("one item without additional Profiles", () => {
  const REF = {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ITEM1",
    groupID: null,
    indexedKey: "ITEM1",
    title: "Item 1",
  };

  /**
   * The services the one-item path reads, over an Item `ITEM1` with `note` as
   * its Literature Note, or none; `notifier` records the notices, and
   * `feature` answers the Note Feature's writes.
   */
  function oneItemServices(
    notifier: ReturnType<typeof testNotifier>,
    feature: Partial<NoteFeature["Service"]>,
    note?: TFile,
  ) {
    const opened: string[] = [];
    const reads = readsAnswering({
      DisplayRefs: () => Stream.make([{ itemID: 1, ref: REF }]),
      ItemsByIndexedKeys: ({ indexedKeys }) =>
        Effect.succeed(
          new Map(
            indexedKeys.map((indexedKey) => [
              indexedKey,
              stubService<Item>("Item", { itemID: 1, indexedKey }),
            ]),
          ),
        ),
    });
    const layer = Layer.mergeAll(
      Layer.mock(NoteFeature, feature),
      Layer.mock(LibraryScope, {}),
      Layer.mock(MetadataCache, {
        fileCache: () =>
          Effect.succeed({ frontmatter: { [FIELD_ZOTERO_KEY]: "ABCD2345" } }),
      }),
      Layer.mock(Workspace, {
        openLinkText: (path) => Effect.sync(() => void opened.push(path)),
      }),
      Layer.mock(NoteIndex, {
        whenIndexed: Effect.void,
        getNotesByItemKey: () => Effect.succeed(note ? [note] : []),
      }),
      notifier.layer,
      Layer.mock(PluginSettings, {}),
      Layer.mock(Profile, {
        profiles: Effect.succeed([]),
      }),
      // Only the real Profile picker reads it; the fake view does not.
      Layer.mock(ZoteroPref, {}),
      Layer.mock(ZoteroReads, {
        current: Effect.succeed(
          stubService<ZoteroReadsState>("ZoteroReadsState", {
            state: "ready",
          }),
        ),
        reads,
        snapshot: Effect.succeed(reads),
      }),
    );
    return { layer, opened };
  }

  it.effect(
    "never creates when the metadata scope finds no literature note",
    () =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const createNote = vi.fn<NoteFeature["Service"]["createNote"]>();
        const { layer, opened } = oneItemServices(notifier, { createNote });
        const ports: BatchUpdatePorts = {
          notices: batchUpdateNotices(stubService<App>("App", {})),
          // The single-update path opens no batch modal.
          bridge: stubService<BatchUpdatePorts["bridge"]>("EffectBridge", {}),
          view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {}),
        };

        const result = yield* runBatchUpdateEffect(ports, [1], {
          scope: "metadata",
        }).pipe(Effect.provide(layer));

        expect(result).toEqual({ outcome: "single-update" });
        expect(createNote).not.toHaveBeenCalled();
        expect(opened).toEqual([]);
        expect(
          notifier.notices.map(({ messages: [message] }) => message),
        ).toEqual([m.notice_update_metadata_no_note()]);
      }),
  );

  it.effect("returns only after the note update has settled", () =>
    Effect.gen(function* () {
      const note = noteAt("Literature/Item.md");
      const called = yield* Deferred.make<void>();
      const written = yield* Deferred.make<UpdateResult>();
      const updateNote = vi.fn<NoteFeature["Service"]["updateNote"]>(() => {
        Deferred.doneUnsafe(called, Exit.void);
        return Deferred.await(written);
      });
      const { layer } = oneItemServices(testNotifier(), { updateNote }, note);
      const ports: BatchUpdatePorts = {
        notices: batchUpdateNotices(stubService<App>("App", {})),
        // The single-update path opens no batch modal.
        bridge: stubService<BatchUpdatePorts["bridge"]>("EffectBridge", {}),
        view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {}),
      };

      const run = yield* runBatchUpdateEffect(ports, [1], {
        scope: "full",
      }).pipe(Effect.provide(layer), Effect.forkChild);
      yield* Deferred.await(called);
      // While the write is pending, the run does not end.
      const early = yield* Fiber.await(run).pipe(
        Effect.timeoutOption("1 second"),
        Effect.forkChild,
      );
      yield* TestClock.adjust("1 second");

      expect(updateNote).toHaveBeenCalledExactlyOnceWith(note, {
        indexedKey: "ABCD2345",
        scope: "full",
        profile: undefined,
      });
      expect(Option.isNone(yield* Fiber.join(early))).toBe(true);
      yield* Deferred.succeed(written, {
        bodyUpdated: true,
        duplicateRegionCount: 0,
      });
      expect(yield* Fiber.join(run)).toEqual({ outcome: "single-update" });
    }),
  );

  it.effect("creates and opens a note when the full scope finds none", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const createNote = vi.fn<NoteFeature["Service"]["createNote"]>(() =>
        Effect.succeed({
          outcome: "created",
          file: noteAt("Literature/New.md"),
        }),
      );
      const { layer, opened } = oneItemServices(notifier, { createNote });
      const ports: BatchUpdatePorts = {
        notices: batchUpdateNotices(stubService<App>("App", {})),
        // The single-update path opens no batch modal.
        bridge: stubService<BatchUpdatePorts["bridge"]>("EffectBridge", {}),
        view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {}),
      };

      const result = yield* runBatchUpdateEffect(ports, [1], {
        scope: "full",
      }).pipe(Effect.provide(layer));

      expect(result).toEqual({ outcome: "single-update" });
      expect(createNote).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ indexedKey: "ITEM1" }),
        { profile: undefined },
      );
      expect(opened).toEqual(["Literature/New.md"]);
    }),
  );

  it.effect("passes a note update that dies to the run", () =>
    Effect.gen(function* () {
      const note = noteAt("Literature/Item.md");
      const defect = new Error("update died");
      const { layer } = oneItemServices(
        testNotifier(),
        { updateNote: () => Effect.die(defect) },
        note,
      );
      const ports: BatchUpdatePorts = {
        notices: batchUpdateNotices(stubService<App>("App", {})),
        // The single-update path opens no batch modal.
        bridge: stubService<BatchUpdatePorts["bridge"]>("EffectBridge", {}),
        view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {}),
      };

      const exit = yield* runBatchUpdateEffect(ports, [1], {
        scope: "full",
      }).pipe(Effect.provide(layer), Effect.exit);

      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(defect);
    }),
  );

  it.effect("passes a create that dies to the run", () =>
    Effect.gen(function* () {
      const defect = new Error("create died");
      const { layer, opened } = oneItemServices(testNotifier(), {
        createNote: () => Effect.die(defect),
      });
      const ports: BatchUpdatePorts = {
        notices: batchUpdateNotices(stubService<App>("App", {})),
        // The single-update path opens no batch modal.
        bridge: stubService<BatchUpdatePorts["bridge"]>("EffectBridge", {}),
        view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {}),
      };

      const exit = yield* runBatchUpdateEffect(ports, [1], {
        scope: "full",
      }).pipe(Effect.provide(layer), Effect.exit);

      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(defect);
      expect(opened).toEqual([]);
    }),
  );
});

it.effect.each([false, true])(
  "reports affected creations once per batch (prepared Profiles: %s)",
  (prepared) =>
    Effect.gen(function* () {
      const deps = makeDeps();
      const report = vi.fn<NoteFeature["Service"]["reportExcerptImages"]>(
        () => Effect.void,
      );
      deps.noteFeature.reportExcerptImages = report;
      const summaries = [
        { zotero: 1, unchecked: 0, unavailable: 1 },
        { zotero: 0, unchecked: 1, unavailable: 2 },
      ];
      const create = (
        id: number,
        options?: Pick<CreateNoteOptions, "reportExcerpts">,
      ): Effect.Effect<CreateNoteResult> =>
        Effect.sync(() => {
          expect(options?.reportExcerpts).toBeTypeOf("function");
          options!.reportExcerpts!(summaries[id - 1]!);
          expect(report).not.toHaveBeenCalled();
          return {
            outcome: "created",
            file: noteAt(`Literature/Item ${id}.md`),
          };
        });
      deps.noteFeature.createNote = (item, options) =>
        create(item.itemID, options);
      if (prepared) {
        deps.profile = profileReader({
          ...defaults,
          profiles: [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }],
        });
        deps.noteFeature.planCreations = (keys) =>
          Effect.succeed(
            creationPlans(keys, (item) => ({
              selection: {
                selector: "default",
                source: "bound",
                shouldAsk: false,
              },
              previews: [
                {
                  selector: "default",
                  label: undefined,
                  folder: "Literature",
                  citationStyle: null,
                  document: undefined,
                  path: `Literature/Item ${item.itemID}.md`,
                  create: (options) => create(item.itemID, options),
                },
              ],
            })),
          );
      }
      itemsIn(
        new Map([
          [1, USER_LIBRARY_ID],
          [2, USER_LIBRARY_ID],
        ]),
      );
      yield* runBatchUpdate(deps, [1, 2]);
      yield* Effect.promise(() => classifyLastModal());
      const result = yield* Effect.promise(() =>
        openedModals.at(-1)!.onRun({
          onItemSettled: () => {
            expect(report).not.toHaveBeenCalled();
          },
          stop: Deferred.makeUnsafe<void>(),
        }),
      );
      expect(result).toMatchObject({ created: 2, failed: 0 });
      expect(report).toHaveBeenCalledExactlyOnceWith({
        zotero: 1,
        unchecked: 1,
        unavailable: 3,
      });
    }),
);

it.effect(
  "runs every row of one update batch under one outcome scope, released after the run",
  () =>
    Effect.gen(function* () {
      const deps = makeDeps();
      const probe = yield* Effect.acquireDisposable(
        Effect.sync(excerptReuseProbe),
      );
      const scopes: (ExcerptOutcomeScope | undefined)[] = [];
      // Each row resolves the probe's excerpt in turn, so the second resolution
      // cannot be merged into the first one's in-flight request: only the run's own
      // retention can answer it.
      let resolutions: Promise<unknown> = Promise.resolve();
      const resolveThrough = (outcomes: ExcerptOutcomeScope | undefined) =>
        Effect.promise(() => {
          scopes.push(outcomes);
          resolutions = resolutions.then(() => probe.resolve(outcomes));
          return resolutions;
        });
      deps.noteFeature.writeNoteUpdate = (_file, options) =>
        resolveThrough(options.outcomes).pipe(
          Effect.as({ bodyUpdated: true, duplicateRegionCount: 0 }),
        );
      deps.noteFeature.createNote = (_item, options) =>
        resolveThrough(options?.outcomes).pipe(
          Effect.as({
            outcome: "created",
            file: noteAt("Literature/New.md"),
          } satisfies CreateNoteResult),
        );
      deps.noteIndex.getNotesByItemKey = (key) =>
        key === "ITEM1" ? [noteAt("Literature/Item1.md")] : [];
      itemsIn(
        new Map([
          [1, USER_LIBRARY_ID],
          [2, USER_LIBRARY_ID],
        ]),
      );

      yield* runBatchUpdate(deps, [1, 2]);
      const modal = openedModals.at(-1)!;
      yield* Effect.promise(() =>
        modal.onClassify({
          onProgress: vi.fn(),
          signal: new AbortController().signal,
        }),
      );
      const result = yield* Effect.promise(() =>
        modal.onRun({
          onItemSettled: vi.fn(),
          stop: Deferred.makeUnsafe<void>(),
        }),
      );

      expect(result).toMatchObject({ created: 1, updated: 1, failed: 0 });
      // One run is one batch: both rows' notes share one scope, and the second one
      // reuses the outcome the first produced instead of rendering it again.
      expect(scopes).toHaveLength(2);
      expect(scopes[1]).toBe(scopes[0]);
      expect(probe.renders()).toBe(1);
      // The run released what it retained, so a later note driven through the same
      // scope renders again rather than reusing.
      yield* Effect.promise(() => probe.resolve(scopes[0]));
      expect(probe.renders()).toBe(2);
    }),
);

it.effect(
  "classifies conflicting Companion Profiles as kept rows before any write or picker",
  () =>
    Effect.gen(function* () {
      const books = "Bk3Qn7XvT2Lp" as ProfileId;
      const deps = makeDeps();
      deps.profile = profileReader(
        { ...defaults, profiles: [{ id: books, label: "Books" }] },
        {
          getFileCache: (file) => ({
            frontmatter: file.path.startsWith("Books/")
              ? { "zotlit-profile": `Books (${books})` }
              : {},
          }),
        },
      );
      const create = vi.fn<PlannedCreationProfile["create"]>(() =>
        Effect.succeed({ outcome: "created", file: noteAt("Books/New.md") }),
      );
      const createDefault = vi.fn<PlannedCreationProfile["create"]>(() =>
        Effect.succeed({
          outcome: "created",
          file: noteAt("Literature/New.md"),
        }),
      );
      const writeNoteUpdate = vi.fn<NoteFeature["Service"]["writeNoteUpdate"]>(
        () => Effect.succeed({ bodyUpdated: true, duplicateRegionCount: 0 }),
      );
      deps.noteFeature.writeNoteUpdate = writeNoteUpdate;
      // A remembered Profile persisted by an earlier version stays inert.
      Object.assign(deps.settings, {
        current: Effect.succeed({
          ...defaults,
          "note.last-used-profile": books,
        }),
      });
      using settingsUpdate = vi.spyOn(deps.settings, "update");
      deps.noteFeature.planCreations = vi.fn((keys) =>
        Effect.succeed(
          creationPlans(keys, () => ({
            selection: { selector: books, source: "headless", shouldAsk: true },
            previews: [
              {
                selector: books,
                label: "Books",
                folder: "Books",
                citationStyle: null,
                document: undefined,
                path: "Books/New.md",
                create,
              },
              {
                selector: "default",
                label: undefined,
                folder: "Literature",
                citationStyle: null,
                document: undefined,
                path: "Literature/New.md",
                create: createDefault,
              },
            ],
          })),
        ),
      );
      deps.noteIndex.getNotesByItemKey = (key) =>
        key === "ITEM2"
          ? [{ path: "Books/Old.md" } as any]
          : key === "ITEM3"
            ? [{ path: "Literature/Other.md" } as any]
            : [];
      itemsIn(
        new Map([
          [1, USER_LIBRARY_ID],
          [2, USER_LIBRARY_ID],
          [3, USER_LIBRARY_ID],
        ]),
      );
      chooseProfile.mockClear();
      yield* runBatchUpdate(deps, [1, 2, 3], { profile: books });
      const modal = openedModals.at(-1)!;
      const manifest = (yield* Effect.promise(() =>
        modal.onClassify({
          onProgress: vi.fn(),
          signal: new AbortController().signal,
        }),
      )) as any;
      expect(manifest.options.tasks).toMatchObject([
        { id: 1, profile: "Books", path: "Books/New.md" },
        { id: 2, profile: "Books" },
      ]);
      expect(manifest.options.kept).toEqual([
        {
          label: "Item 3",
          profile: m.settings_profile_default_name(),
          reason: m.batch_profile_kept_reason({
            label: m.settings_profile_default_name(),
            requested: "Books",
          }),
        },
      ]);
      expect(manifest.counts.actionable).toBe(2);
      expect(chooseProfile).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(settingsUpdate).not.toHaveBeenCalled();
      // Every row carries the Companion's Profile, so the only control is the
      // explicit all-new override.
      const choices: BatchProfileChoice[] = manifest.options.profileChoices;
      expect(choices.map(({ scope }) => scope)).toEqual(["all-new"]);
      const choice = choices[0]!;
      expect(choice).toMatchObject({
        label: "Books",
        source: "headless",
        count: 1,
      });
      chooseProfile
        .mockReturnValueOnce(pickerClosed)
        .mockReturnValueOnce(Effect.succeed("default"));
      yield* Effect.promise(() => choice.choose());
      expect(manifest.options.tasks[0].path).toBe("Books/New.md");
      yield* Effect.promise(() => choice.choose());
      expect(manifest.options.tasks[0]).toMatchObject({
        profile: m.settings_profile_default_name(),
        path: "Literature/New.md",
      });
      expect(choice.source).toBe("asked");
      expect(settingsUpdate).not.toHaveBeenCalled();
      const result = yield* Effect.promise(() =>
        modal.onRun({
          onItemSettled: vi.fn(),
          stop: Deferred.makeUnsafe<void>(),
        }),
      );
      expect(result).toMatchObject({
        created: 1,
        updated: 1,
        failed: 0,
        skipped: 0,
      });
      expect(settingsUpdate).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(createDefault).toHaveBeenCalledOnce();
      expect(writeNoteUpdate).toHaveBeenCalledOnce();
      expect(writeNoteUpdate.mock.calls[0]).not.toHaveProperty("1.profile");
      expect(
        modal.text.runSummary(result, { cancelled: false, aborted: false }),
      ).toBe(
        m.batch_profile_summary({
          created: m.batch_profile_created({
            count: 1,
            label: m.settings_profile_default_name(),
          }),
          updated: m.batch_profile_updated({ count: 1, label: "Books" }),
          kept: 1,
          failed: 0,
          skipped: 0,
          notFound: 0,
        }),
      );
    }),
);

it.effect.each([true, false])(
  "shows an unknown Literature Note stamp and preserves recovery (additional Profiles: %s)",
  (additionalProfiles) =>
    Effect.gen(function* () {
      const stamp = "Retired (Qw8Er5Ty2Ui9)";
      const file = noteAt("Reading/Paper.md");
      const deps = makeDeps();
      deps.profile = profileReader(
        {
          ...defaults,
          profiles: additionalProfiles
            ? [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }]
            : [],
        },
        {
          getFileCache: () => ({ frontmatter: { "zotlit-profile": stamp } }),
        },
      );
      deps.noteIndex.getNotesByItemKey = () => [file];
      itemsIn(new Map([[1, USER_LIBRARY_ID]]));
      deps.noteFeature.writeNoteUpdate = () =>
        Effect.succeed({
          bodyUpdated: false,
          duplicateRegionCount: 0,
          diagnostic: unknownProfileDiagnostic(stamp, { path: file.path }),
        });
      yield* runBatchUpdate(deps, [1, 2]);
      const options = openedModals.at(-1)!;
      const manifest = (yield* Effect.promise(() =>
        options.onClassify({
          onProgress: vi.fn(),
          signal: new AbortController().signal,
        }),
      )) as any;
      expect(manifest.options.tasks).toMatchObject([{ id: 1 }]);
      expect(manifest.options.tasks[0].profile).toBe(
        additionalProfiles ? stamp : undefined,
      );
      expect(manifest.options.profileChoices).toBeUndefined();
      const onItemSettled = vi.fn();
      expect(
        yield* Effect.promise(() =>
          options.onRun({
            onItemSettled,
            stop: Deferred.makeUnsafe<void>(),
          }),
        ),
      ).toMatchObject({ created: 0, updated: 0, failed: 1 });
      expect(onItemSettled).toHaveBeenCalledExactlyOnceWith({
        id: 1,
        status: "failed",
        failure: {
          label: "Item 1",
          message: m.notice_literature_note_profile_unknown({ stamp }),
          recovery: { action: "switch-profile", path: file.path },
        },
      });
    }),
);

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const ARTICLES = "Ar7Kd2QpX9Mn" as ProfileId;
const RETIRED_STAMP = "Retired (Qw8Er5Ty2Ui9)";
const INVALID_PROBLEM = m.modal_profile_problem_invalid_selector({
  selector: "Missing12345",
});
const FOLDERS: Record<ProfileSelector, string> = {
  default: "Literature",
  [BOOKS]: "Books",
  [ARTICLES]: "Articles",
};

/**
 * A mixed batch: rows 1 and 2 match different matches, 3 and 4 match none,
 * 5 has an invalid explicit selector, 6 has a Books-stamped note, 7 an unstamped note, and
 * 8 a note with an unknown stamp. Every selection comes from the (stubbed)
 * shared boundary keyed by the Item it receives.
 */
function mixedBatch() {
  const deps = makeDeps();
  const cache = {
    getFileCache: (file: TFile) => ({
      frontmatter: file.path.startsWith("Books/")
        ? { "zotlit-profile": `Books (${BOOKS})` }
        : file.path.startsWith("Reading/")
          ? { "zotlit-profile": RETIRED_STAMP }
          : {},
    }),
  };
  const profiles = [
    { id: BOOKS, label: "Books" },
    { id: ARTICLES, label: "Articles" },
  ];
  deps.profile = profileReader({ ...defaults, profiles }, cache);
  const selections: Record<number, CreationProfileSelection> = {
    1: {
      selector: BOOKS,
      source: "match",
      shouldAsk: false,
      reason: m.profile_match_selected({ profile: "Books" }),
    },
    2: {
      selector: ARTICLES,
      source: "match",
      shouldAsk: true,
      reason: m.profile_match_selected({ profile: "Articles" }),
    },
    3: { selector: "default", source: "bound", shouldAsk: true },
    4: { selector: "default", source: "bound", shouldAsk: true },
    5: {
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: {
        kind: "invalid-selector",
        source: "headless",
        selector: "Missing12345" as ProfileId,
      },
    },
  };
  const created: { itemID: number; selector: ProfileSelector }[] = [];
  const plansFor = (itemID: number): PlannedCreationProfile[] =>
    (["default", BOOKS, ARTICLES] as const).map((selector) => ({
      selector,
      label: profiles.find(({ id }) => id === selector)?.label,
      folder: FOLDERS[selector]!,
      citationStyle: null,
      document: undefined,
      path: `${FOLDERS[selector]}/Item ${itemID}.md`,
      create: () =>
        Effect.sync(() => {
          created.push({ itemID, selector });
          return {
            outcome: "created" as const,
            file: noteAt(`${FOLDERS[selector]}/Item ${itemID}.md`),
          };
        }),
    }));
  const planCreations = vi.fn<NoteFeature["Service"]["planCreations"]>((keys) =>
    Effect.succeed(
      creationPlans(keys, ({ itemID }) => ({
        selection: selections[itemID]!,
        previews: plansFor(itemID),
      })),
    ),
  );
  deps.noteFeature.planCreations = planCreations;
  const updated: string[] = [];
  deps.noteFeature.writeNoteUpdate = (file) =>
    Effect.sync(() => {
      updated.push(file.path);
      return file.path.startsWith("Reading/")
        ? {
            bodyUpdated: false,
            duplicateRegionCount: 0,
            diagnostic: unknownProfileDiagnostic(RETIRED_STAMP, {
              path: file.path,
            }),
          }
        : { bodyUpdated: true, duplicateRegionCount: 0 };
    });
  const notes: Record<string, string> = {
    ITEM6: "Books/Old.md",
    ITEM7: "Literature/Other.md",
    ITEM8: "Reading/Retired.md",
  };
  deps.noteIndex.getNotesByItemKey = (key) =>
    key in notes ? [noteAt(notes[key]!)] : [];
  itemsIn(new Map([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, USER_LIBRARY_ID])));
  chooseProfile.mockReset();
  return { deps, planCreations, created, updated, selections };
}

const classifyMixedBatch = Effect.fnUntraced(function* (
  deps: UpdateDeps,
  bridge?: BatchUpdatePorts["bridge"],
) {
  yield* runBatchUpdate(deps, [1, 2, 3, 4, 5, 6, 7, 8], { bridge });
  const modal = openedModals.at(-1)!;
  const manifest = (yield* Effect.promise(() =>
    modal.onClassify({
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    }),
  )) as any;
  const choices: BatchProfileChoice[] = manifest.options.profileChoices;
  const choice = (scope: BatchProfileChoice["scope"]) =>
    choices.find((entry) => entry.scope === scope)!;
  const run = () =>
    modal.onRun({ onItemSettled, stop: Deferred.makeUnsafe<void>() });
  const onItemSettled = vi.fn();
  return {
    modal,
    tasks: manifest.options.tasks as Record<string, unknown>[],
    choices,
    choice,
    run,
    onItemSettled,
  };
});

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const DEFAULT_LABEL = () => m.settings_profile_default_name();

describe("mixed batch", () => {
  it.effect(
    "closes the Profile picker when unload interrupts the choice, which resolves undefined",
    () =>
      Effect.gen(function* () {
        const { deps } = mixedBatch();
        const unload = yield* Scope.make();
        const bridge = yield* scopedBridge.pipe(Scope.provide(unload));
        const opened = yield* Deferred.make<void>();
        const close = vi.fn();
        chooseProfile.mockImplementationOnce(() =>
          awaitModal<ProfileSelector | undefined>(() => {
            Deferred.doneUnsafe(opened, Exit.void);
            return { close };
          }),
        );
        const { choice } = yield* classifyMixedBatch(deps, bridge);

        const choosing = choice("unresolved").choose();
        yield* Deferred.await(opened);
        yield* Scope.close(unload, Exit.void);

        expect(yield* Effect.promise(() => choosing)).toBeUndefined();
        expect(close).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "prepares each new row from its own selection and keeps the fallback to unmatched rows",
    () =>
      Effect.gen(function* () {
        const { deps, planCreations, created, updated } = mixedBatch();
        const { modal, tasks, choices, choice, run, onItemSettled } =
          yield* classifyMixedBatch(deps);

        // One call resolves every new row (#1642).
        expect(planCreations).toHaveBeenCalledExactlyOnceWith(
          [1, 2, 3, 4, 5].map((itemID) => `ITEM${itemID}`),
          { headless: undefined },
        );
        expect(tasks).toMatchObject([
          {
            id: 1,
            profile: "Books",
            path: "Books/Item 1.md",
            reason: m.profile_match_selected({ profile: "Books" }),
          },
          {
            id: 2,
            profile: "Articles",
            path: "Articles/Item 2.md",
            reason: m.profile_match_selected({ profile: "Articles" }),
          },
          {
            id: 3,
            profile: DEFAULT_LABEL(),
            path: "Literature/Item 3.md",
            reason: m.profile_match_unmatched(),
          },
          { id: 4, profile: DEFAULT_LABEL(), path: "Literature/Item 4.md" },
          {
            id: 5,
            profile: undefined,
            path: undefined,
            reason: INVALID_PROBLEM,
          },
          { id: 6, profile: "Books" },
          { id: 7, profile: DEFAULT_LABEL() },
          { id: 8, profile: RETIRED_STAMP },
        ]);
        expect(choices.map(({ scope }) => scope)).toEqual([
          "unresolved",
          "affected",
          "all-new",
        ]);
        expect(choice("unresolved")).toMatchObject({
          count: 2,
          label: DEFAULT_LABEL(),
          source: "bound",
        });
        expect(choice("affected")).toMatchObject({
          count: 1,
          label: undefined,
        });
        expect(choice("all-new")).toMatchObject({ count: 5, label: undefined });

        // The fallback moves the two unmatched rows only.
        chooseProfile.mockReturnValueOnce(Effect.succeed(BOOKS));
        yield* Effect.promise(() => choice("unresolved").choose());
        expect(chooseProfile).toHaveBeenLastCalledWith(
          expect.objectContaining({
            indexedKey: "ITEM3",
            selection: {
              selector: "default",
              source: "bound",
              shouldAsk: true,
            },
            problem: undefined,
          }),
        );
        expect(tasks.slice(0, 5)).toMatchObject([
          { id: 1, profile: "Books", path: "Books/Item 1.md" },
          { id: 2, profile: "Articles", path: "Articles/Item 2.md" },
          {
            id: 3,
            profile: "Books",
            path: "Books/Item 3.md",
            reason: m.batch_profile_source_chosen(),
          },
          { id: 4, profile: "Books", path: "Books/Item 4.md" },
          {
            id: 5,
            profile: undefined,
            path: undefined,
            reason: INVALID_PROBLEM,
          },
        ]);
        expect(choice("unresolved")).toMatchObject({
          label: "Books",
          source: "asked",
        });
        expect(choice("affected")).toMatchObject({
          count: 1,
          label: undefined,
        });

        // Cancelling the recovery leaves the affected row without a destination.
        chooseProfile.mockReturnValueOnce(pickerClosed);
        yield* Effect.promise(() => choice("affected").choose());
        expect(chooseProfile).toHaveBeenLastCalledWith(
          expect.objectContaining({
            indexedKey: "ITEM5",
            problem: INVALID_PROBLEM,
          }),
        );
        expect(tasks[4]).toMatchObject({ id: 5, profile: undefined });

        const result = yield* Effect.promise(() => run());
        expect(result).toMatchObject({
          created: 4,
          updated: 2,
          failed: 2,
          skipped: 0,
        });
        expect(created).toEqual([
          { itemID: 1, selector: BOOKS },
          { itemID: 2, selector: ARTICLES },
          { itemID: 3, selector: BOOKS },
          { itemID: 4, selector: BOOKS },
        ]);
        expect(updated).toEqual([
          "Books/Old.md",
          "Literature/Other.md",
          "Reading/Retired.md",
        ]);
        expect(onItemSettled).toHaveBeenCalledWith({
          id: 5,
          status: "failed",
          failure: { label: "Item 5", message: INVALID_PROBLEM },
        });
        expect(onItemSettled).toHaveBeenCalledWith({
          id: 8,
          status: "failed",
          failure: {
            label: "Item 8",
            message: m.notice_literature_note_profile_unknown({
              stamp: RETIRED_STAMP,
            }),
            recovery: { action: "switch-profile", path: "Reading/Retired.md" },
          },
        });
        const summary = modal.text.runSummary(result, {
          cancelled: false,
          aborted: false,
        });
        for (const part of [
          m.batch_profile_created({ count: 3, label: "Books" }),
          m.batch_profile_created({ count: 1, label: "Articles" }),
          m.batch_profile_updated({ count: 1, label: "Books" }),
          m.batch_profile_updated({ count: 1, label: DEFAULT_LABEL() }),
        ])
          expect(summary).toContain(part);
        expect(summary).toContain("2 failed");
      }),
  );

  it.effect(
    "overrides every new note with one explicit Profile and leaves existing notes to their stamps",
    () =>
      Effect.gen(function* () {
        const { deps, created, updated } = mixedBatch();
        const { modal, tasks, choice, run } = yield* classifyMixedBatch(deps);

        chooseProfile.mockReturnValueOnce(Effect.succeed(ARTICLES));
        yield* Effect.promise(() => choice("all-new").choose());
        expect(tasks).toMatchObject([
          { id: 1, profile: "Articles", path: "Articles/Item 1.md" },
          { id: 2, profile: "Articles", path: "Articles/Item 2.md" },
          { id: 3, profile: "Articles", path: "Articles/Item 3.md" },
          { id: 4, profile: "Articles", path: "Articles/Item 4.md" },
          {
            id: 5,
            profile: "Articles",
            path: "Articles/Item 5.md",
            reason: m.batch_profile_source_chosen(),
          },
          { id: 6, profile: "Books" },
          { id: 7, profile: DEFAULT_LABEL() },
          { id: 8, profile: RETIRED_STAMP },
        ]);
        expect(choice("all-new")).toMatchObject({
          label: "Articles",
          source: "asked",
          count: 5,
        });
        expect(choice("unresolved")).toMatchObject({ label: "Articles" });
        expect(choice("affected")).toMatchObject({ label: "Articles" });

        const result = yield* Effect.promise(() => run());
        expect(result).toMatchObject({ created: 5, updated: 2, failed: 1 });
        expect(created.map(({ selector }) => selector)).toEqual(
          Array(5).fill(ARTICLES),
        );
        expect(updated).toHaveLength(3);
        const summary = modal.text.runSummary(result, {
          cancelled: false,
          aborted: false,
        });
        expect(summary).toContain(
          m.batch_profile_created({ count: 5, label: "Articles" }),
        );
        expect(summary).not.toContain(
          m.batch_profile_created({ count: 1, label: "Books" }),
        );
      }),
  );

  it.effect(
    "stops a creation whose Profile was removed after the preview and keeps the others frozen",
    () =>
      Effect.gen(function* () {
        const { deps, created, planCreations } = mixedBatch();
        const { tasks, run, onItemSettled } = yield* classifyMixedBatch(deps);
        planCreations.mockClear();

        // Articles disappears between preview and run; the rows keep the
        // destinations they showed, and no selection is computed again.
        deps.profile = profileReader({
          ...defaults,
          profiles: [{ id: BOOKS, label: "Books" }],
        });
        const result = yield* Effect.promise(() => run());
        expect(result).toMatchObject({ created: 3, updated: 2, failed: 3 });
        expect(created).toEqual([
          { itemID: 1, selector: BOOKS },
          { itemID: 3, selector: "default" },
          { itemID: 4, selector: "default" },
        ]);
        expect(onItemSettled).toHaveBeenCalledWith({
          id: 2,
          status: "failed",
          failure: {
            label: "Item 2",
            message: m.notice_literature_note_profile_unknown({
              stamp: ARTICLES,
            }),
          },
        });
        expect(planCreations).not.toHaveBeenCalled();
        expect(tasks[1]).toMatchObject({ id: 2, path: "Articles/Item 2.md" });
      }),
  );
});

describe("runBatchUpdateAll", () => {
  it.effect("returns db-unavailable when the database is closed", () =>
    Effect.gen(function* () {
      const scope = scopeReads();
      expect(yield* runBatchUpdateAll(makeDeps("loading", scope.wrap))).toEqual(
        {
          outcome: "db-unavailable",
        } satisfies BatchUpdateResult,
      );
      expect(scope.asked()).toEqual([]);
    }),
  );

  it.effect("reports an empty library scope before querying any item", () =>
    Effect.gen(function* () {
      currentScope = scopeOf([], [{ type: "group", groupID: 7 }]);
      const scope = scopeReads();

      expect(yield* runBatchUpdateAll(makeDeps("ready", scope.wrap))).toEqual({
        outcome: "no-library-in-scope",
      });
      expect(scope.asked()).toEqual([]);
      expect(openedModals).toHaveLength(0);
    }),
  );

  it.effect(
    "updates every item of every library in scope, in canonical order",
    () =>
      Effect.gen(function* () {
        currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
            [3, GROUP_LIBRARY.libraryID],
          ]),
        );
        const scope = scopeReads();

        expect(yield* runBatchUpdateAll(makeDeps("ready", scope.wrap))).toEqual(
          {
            outcome: "batch-modal",
          },
        );
        expect(scope.asked()).toEqual([
          USER_LIBRARY_ID,
          GROUP_LIBRARY.libraryID,
        ]);
        expect(openedModals[0]?.total).toBe(3);
      }),
  );

  it.effect(
    "runs the available subset and states the unavailable library count",
    () =>
      Effect.gen(function* () {
        currentScope = scopeOf(
          [PERSONAL_LIBRARY],
          [{ type: "group", groupID: 9 }],
        );
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );

        yield* runBatchUpdateAll(makeDeps());

        const { intro } = yield* Effect.promise(() => classifyLastModal());
        expect(intro).toContain("1 selected library is unavailable.");
      }),
  );

  it.effect("keeps action-only headings while one library contributes", () =>
    Effect.gen(function* () {
      currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
      itemsIn(
        new Map([
          [1, USER_LIBRARY_ID],
          [2, USER_LIBRARY_ID],
        ]),
      );

      yield* runBatchUpdateAll(makeDeps());

      const { groups, intro } = yield* Effect.promise(() =>
        classifyLastModal(),
      );
      expect(groups.map((group) => group.header({ count: 2 }))).toEqual([
        "Update (2)",
        "Create (2)",
      ]);
      expect(intro).not.toContain("unavailable");
    }),
  );

  it.effect(
    "groups rows by library and action when several libraries contribute",
    () =>
      Effect.gen(function* () {
        currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [3, GROUP_LIBRARY.libraryID],
          ]),
        );

        yield* runBatchUpdateAll(makeDeps());

        const { tasks, groups } = yield* Effect.promise(() =>
          classifyLastModal(),
        );
        expect(tasks).toEqual([
          expect.objectContaining({ id: 1, kind: "1:create" }),
          expect.objectContaining({ id: 3, kind: "12:create" }),
        ]);
        expect(groups.map((group) => group.header({ count: 1 }))).toEqual([
          "My Library · Update (1)",
          "My Library · Create (1)",
          "Reading group · Update (1)",
          "Reading group · Create (1)",
        ]);
      }),
  );

  it.effect(
    "routes a one-item multi-library expansion to the single-item path",
    () =>
      Effect.gen(function* () {
        currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
        itemsIn(new Map([[3, GROUP_LIBRARY.libraryID]]));
        // The one item goes to the trash between the library listing and its
        // lookup, so the single-item path answers not-found.
        const deps = makeDeps("ready", (client) => ({
          ...client,
          DisplayRefs: ((payload: object, options?: object) => {
            db.$client.exec("insert into deletedItems (itemID) values (3)");
            return (
              client.DisplayRefs as unknown as (
                payload: object,
                options?: object,
              ) => unknown
            )(payload, options);
          }) as unknown as ZoteroReadsClient["DisplayRefs"],
        }));

        expect(yield* runBatchUpdateAll(deps)).toEqual({
          outcome: "not-found",
        });
        expect(openedModals).toHaveLength(0);
      }),
  );

  describe("exact target", () => {
    it.effect("resolves the named group outside library scope", () =>
      Effect.gen(function* () {
        currentScope = scopeOf([PERSONAL_LIBRARY]);
        itemsIn(
          new Map([
            [1, GROUP_LIBRARY.libraryID],
            [2, GROUP_LIBRARY.libraryID],
          ]),
        );
        const scope = scopeReads();

        expect(
          yield* runBatchUpdateAll(makeDeps("ready", scope.wrap), {
            groupID: 7,
          }),
        ).toEqual({ outcome: "batch-modal" });
        expect(scope.asked()).toEqual([GROUP_LIBRARY.libraryID]);
      }),
    );

    it.effect("resolves an absent library parameter to My Library", () =>
      Effect.gen(function* () {
        currentScope = scopeOf([GROUP_LIBRARY]);
        itemsIn(
          new Map([
            [1, USER_LIBRARY_ID],
            [2, USER_LIBRARY_ID],
          ]),
        );
        const scope = scopeReads();

        yield* runBatchUpdateAll(makeDeps("ready", scope.wrap), { groupID: 0 });

        expect(scope.asked()).toEqual([USER_LIBRARY_ID]);
      }),
    );

    it.effect(
      "reports an unavailable group instead of a settings mismatch",
      () =>
        Effect.gen(function* () {
          const scope = scopeReads();
          expect(
            yield* runBatchUpdateAll(makeDeps("ready", scope.wrap), {
              groupID: 99,
            }),
          ).toEqual({ outcome: "unavailable-target" });
          expect(scope.asked()).toEqual([]);
        }),
    );

    it.effect("resolves a collection inside the named library only", () =>
      Effect.gen(function* () {
        itemsIn(
          new Map([
            [4, GROUP_LIBRARY.libraryID],
            [5, GROUP_LIBRARY.libraryID],
          ]),
        );
        collectionHolds(GROUP_LIBRARY.libraryID, [4, 5]);
        const scope = scopeReads();

        expect(
          yield* runBatchUpdateAll(makeDeps("ready", scope.wrap), {
            groupID: 7,
            collectionKey: COLLECTION,
          }),
        ).toEqual({ outcome: "batch-modal" });
        expect(scope.asked()).toEqual([
          { libraryID: GROUP_LIBRARY.libraryID, collectionKey: COLLECTION },
        ]);
        expect(openedModals.at(-1)?.total).toBe(2);
      }),
    );

    it.effect(
      "reports an unknown collection key instead of an empty scope",
      () =>
        Effect.gen(function* () {
          // The key names a collection of another library only.
          collectionHolds(GROUP_LIBRARY.libraryID, []);
          db.$client.exec(
            `delete from collections where libraryID = ${USER_LIBRARY_ID}`,
          );

          expect(
            yield* runBatchUpdateAll(makeDeps(), {
              groupID: 0,
              collectionKey: COLLECTION,
            }),
          ).toEqual({ outcome: "collection-not-found" });
          expect(openedModals).toHaveLength(0);
        }),
    );

    it.effect(
      "reports an empty selection for a collection that holds no items",
      () =>
        Effect.gen(function* () {
          expect(
            yield* runBatchUpdateAll(makeDeps(), {
              groupID: 0,
              collectionKey: COLLECTION,
            }),
          ).toEqual({ outcome: "empty-selection" });
          expect(openedModals).toHaveLength(0);
        }),
    );
  });
});

it.effect(
  "uses one fallback for unmatched and distinct overlaps, exposing all candidates and preserving unique matches",
  () =>
    Effect.gen(function* () {
      const { deps, selections, created } = mixedBatch();
      const profiles = deps.profile.profiles;
      const extra = {
        ...profiles[0]!,
        id: "Mn4Vb8GhJ2Rt" as ProfileId,
        label: "Manual",
      };
      selections[4] = {
        selector: "default",
        source: "bound",
        shouldAsk: true,
        problem: { kind: "overlap", candidates: profiles },
      };
      selections[5] = {
        selector: "default",
        source: "bound",
        shouldAsk: true,
        problem: { kind: "overlap", candidates: [profiles[1]!, extra] },
      };
      const { tasks, choices, choice, run } = yield* classifyMixedBatch(deps);
      expect(choices.map(({ scope }) => scope)).toEqual([
        "unresolved",
        "all-new",
      ]);
      expect(choice("unresolved")).toMatchObject({
        count: 3,
        label: undefined,
      });
      chooseProfile.mockReturnValueOnce(Effect.succeed(BOOKS));
      yield* Effect.promise(() => choice("unresolved").choose());
      expect(chooseProfile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selection: expect.objectContaining({
            problem: { kind: "overlap", candidates: [...profiles, extra] },
          }),
          problem: `${m.modal_profile_problem_overlap({ profiles: "Books, Articles" })} ${m.modal_profile_problem_overlap({ profiles: "Articles, Manual" })}`,
        }),
      );
      expect(tasks.slice(0, 5)).toMatchObject([
        {
          id: 1,
          profile: "Books",
          path: "Books/Item 1.md",
          reason: m.profile_match_selected({ profile: "Books" }),
        },
        {
          id: 2,
          profile: "Articles",
          path: "Articles/Item 2.md",
          reason: m.profile_match_selected({ profile: "Articles" }),
        },
        { id: 3, profile: "Books", path: "Books/Item 3.md" },
        { id: 4, profile: "Books", path: "Books/Item 4.md" },
        { id: 5, profile: "Books", path: "Books/Item 5.md" },
      ]);
      expect(yield* Effect.promise(() => run())).toMatchObject({ created: 5 });
      expect(created.map(({ selector }) => selector)).toEqual([
        BOOKS,
        ARTICLES,
        BOOKS,
        BOOKS,
        BOOKS,
      ]);
    }),
);
