import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Scope,
  Stream,
} from "effect";
import { TFile } from "obsidian";
import type { App, ObsidianProtocolData } from "obsidian";
import { beforeEach, describe, expect, vi } from "vitest";

import type { Attachment, getItemDisplayRefByID, Library } from "@zotlit/db";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { openAttachments } from "@/lib/attachment-open";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { FileManager } from "@/lib/obsidian-file-manager";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { TargetOpener } from "@/services/attachment-open/open-target";
import { toObsidianOpenableAttachments } from "@/services/attachment-open/resolve";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import { LibraryScope } from "@/services/library-scope/service";
import { LocalServer } from "@/services/local-server/service";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@/services/local-server/service";
import { openCompanionNote } from "@/services/note-feature";
import { NoteFeature } from "@/services/note-feature/service";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@/services/note-feature/update-batch";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";
import { NoteImporter } from "@/services/note-import/service";
import type { NoteImportView } from "@/services/note-import/view";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { ShowInLibrary } from "@/views/library/show-in-library";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { openTemplateWorkbench } from "@/views/template-workbench/open";

import { ProtocolOutcome } from "./outcome";
import { layerProtocolHandlers, registerProtocolHandlers } from "./register";
import type { ProtocolDeps } from "./register";

/** The Profile the import dialog answers. */
type ImportedProfile = NonNullable<
  Effect.Success<ReturnType<ProtocolDeps["importProfile"]>>
>;

vi.mock("@/services/note-feature/update-batch", async (importOriginal) => {
  const { Effect } = await import("effect");
  return {
    ...(await importOriginal<
      typeof import("@/services/note-feature/update-batch")
    >()),
    runBatchUpdate: vi.fn(() => Effect.succeed({ outcome: "batch-modal" })),
    runBatchUpdateAll: vi.fn(() => Effect.succeed({ outcome: "batch-modal" })),
  };
});

vi.mock("@/services/note-feature", async (importOriginal) => {
  const { Effect } = await import("effect");
  return {
    ...(await importOriginal<typeof import("@/services/note-feature")>()),
    openCompanionNote: vi.fn(() => Effect.void),
  };
});

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
}));

vi.mock("@/services/attachment-open/resolve", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/attachment-open/resolve")
  >()),
  toObsidianOpenableAttachments: vi.fn(),
}));

vi.mock("@/views/template-workbench/open", () => ({
  openTemplateWorkbench: vi.fn(() => Effect.void),
}));

vi.mock("@/views/template-data-explorer/register", () => ({
  openTemplateDataExplorer: vi.fn(async () => {}),
}));

const SOURCE_ID = "abc12345";

type ItemDisplayRef = NonNullable<ReturnType<typeof getItemDisplayRefByID>>;
type DisplayRefSlice = { itemID: number; ref: ItemDisplayRef | null }[];

/** The ZoteroReads operations the handlers call, answering what a test sets. */
const reads = {
  DisplayRefs: vi.fn((_input: Parameters<ZoteroReadsApi["DisplayRefs"]>[0]) =>
    Stream.make<DisplayRefSlice[]>([]),
  ),
  AttachmentsAt: vi.fn(
    (_input: Parameters<ZoteroReadsApi["AttachmentsAt"]>[0]) =>
      Effect.succeed<readonly Attachment[]>([]),
  ),
  /** My Library and the group "Reading group" (group 7, local id 12). */
  Libraries: vi.fn((_input: Parameters<ZoteroReadsApi["Libraries"]>[0]) =>
    Effect.succeed<Library[]>([
      {
        libraryID: 1,
        version: 0,
        clientVersion: null,
        type: "user",
        groupID: null,
        name: null,
      },
      {
        libraryID: 12,
        version: 0,
        clientVersion: null,
        type: "group",
        groupID: 7,
        name: "Reading group",
      },
    ]),
  ),
  /** Two notes in every Library and collection a plan asks for. */
  ScopeItemIDs: vi.fn((_input: Parameters<ZoteroReadsApi["ScopeItemIDs"]>[0]) =>
    Effect.succeed<number[] | null>([5, 6]),
  ),
};
const readsApi = readsAnswering({
  DisplayRefs: (input) => reads.DisplayRefs(input),
  AttachmentsAt: (input) => reads.AttachmentsAt(input),
  Libraries: (input) => reads.Libraries(input),
  ScopeItemIDs: (input) => reads.ScopeItemIDs(input),
});

/** Item `itemID` reads as `ref`. */
function refOf(ref: ItemDisplayRef): void {
  reads.DisplayRefs.mockReturnValue(
    Stream.make<DisplayRefSlice[]>([{ itemID: ref.itemID, ref }]),
  );
}

/** The id reads as these Attachments. */
function attachmentsAt(attachments: readonly Attachment[]): void {
  reads.AttachmentsAt.mockReturnValue(Effect.succeed(attachments));
}

/** An Attachment row with only the id a handler reads. */
function attachmentOf(itemID: number): Attachment {
  return stubService<Attachment>("Attachment", { itemID });
}

/** An Obsidian-Openable Attachment with the fields the reader reads. */
function openableAttachment(indexedKey: string): ObsidianOpenableAttachment {
  return {
    indexedKey,
    label: `${indexedKey}.pdf`,
    openPath: `attachments/${indexedKey}.pdf`,
    absolutePath: `/vault/attachments/${indexedKey}.pdf`,
  };
}

/** An Item ref as the database reads it. */
const REF: ItemDisplayRef = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD2345",
  groupID: null,
  indexedKey: "ABCD2345",
  title: "Alpha",
};
/** {@link REF} as a handler passes it on: the ref without the title. */
const { title: _title, ...ITEM_REF } = REF;

/** Opens the note import's batch modal; records what a link import opened. */
const openBatchModal = vi.fn<NoteImportView["openBatchModal"]>();
/** The note import's modals, which a link-started import receives. */
const noteImportView = stubService<NoteImportView>("NoteImportView", {
  openBatchModal: (options) => openBatchModal(options),
});

/** Protocol handlers registered by the plugin, keyed by their action id. */
const handlers = new Map<string, (data: ObsidianProtocolData) => unknown>();

function protocolData(
  action: string,
  query: Record<string, string> = {},
): ObsidianProtocolData {
  return { action, ...query };
}

function appStub(members: Partial<App> = {}): App {
  const app = stubService<App>("App", members);
  // Vitest's pretty-printer probes this React marker after a failed match.
  Object.defineProperty(app, "$$typeof", { value: undefined });
  Object.defineProperty(app, "nodeType", { value: undefined });
  Object.defineProperty(app, "tagName", { value: undefined });
  Object.defineProperty(app, "nodeName", { value: undefined });
  return app;
}

/** What one case sets on the services and legacy values the handlers read. */
interface Setup {
  readonly deps?: Partial<ProtocolDeps>;
  /** The Attachment opener the `open-attachment` handler reads. */
  readonly opener?: Pick<TargetOpener["Service"], "open">;
  /** The database state; `ready` by default. */
  readonly state?: ZoteroReadsState["state"];
  readonly updateManyRequests?: Stream.Stream<UpdateManyRequest>;
  readonly importNotesRequests?: Stream.Stream<ImportNotesRequest>;
  /** The vault's files, by path. */
  readonly files?: ReadonlyMap<string, TFile>;
  readonly workspace?: MemoryWorkspace;
  /** Finds a vault file by path; `files` by default. */
  readonly getFileByPath?: (path: string) => Effect.Effect<TFile | null>;
  /** Waits for the Note Index; done at once by default. */
  readonly whenIndexed?: Effect.Effect<void>;
}

/** Each Indexed Key a link showed in the Library View, in order. */
const shownInLibrary: string[] = [];

/** The services the handlers read, over the case's fakes. */
function servicesFor(setup: Setup = {}) {
  return Layer.mergeAll(
    // The import dialog's own services: every case fakes the dialog.
    Layer.mock(Template, {}),
    Layer.mock(FileManager, {}),
    Layer.succeed(
      FileSystem.FileSystem,
      stubService<FileSystem.FileSystem>("FileSystem", {}),
    ),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
          sourceId: SOURCE_ID,
          dataDir: "/data",
          baseAttachmentPath: null,
        }),
      ),
    }),
    Layer.mock(ZoteroReads, {
      current: Effect.succeed(
        stubService<ZoteroReadsState>("ZoteroReadsState", {
          state: setup.state ?? "ready",
        }),
      ),
      reads: readsApi,
      snapshot: Effect.succeed(readsApi),
    }),
    Layer.mock(LocalServer, {
      updateManyRequests: setup.updateManyRequests ?? Stream.empty,
      importNotesRequests: setup.importNotesRequests ?? Stream.empty,
    }),
    Layer.mock(UseLedger, {}),
    Layer.mock(ShowInLibrary, {
      show: (indexedKey) =>
        Effect.sync(() => {
          shownInLibrary.push(indexedKey);
        }),
    }),
    // A link import reads only these members before it opens its modal.
    Layer.mock(NoteIndex, { whenIndexed: setup.whenIndexed ?? Effect.void }),
    Layer.mock(LibraryScope, {}),
    Layer.mock(MetadataCache, {}),
    Layer.mock(NoteFeature, {}),
    Layer.mock(NoteImporter, {}),
    Layer.mock(PluginSettings, {}),
    Layer.mock(Profile, {}),
    Layer.mock(TargetOpener, setup.opener ?? {}),
    Layer.mock(Vault, {
      getFileByPath:
        setup.getFileByPath ??
        ((path: string) => Effect.succeed(setup.files?.get(path) ?? null)),
    }),
    testNotifier().layer,
    layerWorkspaceFrom(setup.workspace ?? new MemoryWorkspace()),
    layerTestObsidianEnv({ basePath: "/vault" }),
  );
}

/** Register the handlers over the case's fakes; the case's Scope stops them. */
const register = Effect.fn("register")(function* (setup: Setup = {}) {
  const plugin = {
    registerObsidianProtocolHandler: (
      action: string,
      handler: (data: ObsidianProtocolData) => unknown,
    ) => {
      handlers.set(action, handler);
    },
  };
  const deps = stubService<ProtocolDeps>("ProtocolDeps", {
    webWorkbenchEnabled: true,
    noteImportView,
    // A link import's modal callbacks would run here; no case drives them.
    bridge: stubService<ProtocolDeps["bridge"]>("EffectBridge", {}),
    app: appStub(),
    ...setup.deps,
  });
  const context = yield* Layer.build(servicesFor(setup));
  return yield* registerProtocolHandlers(plugin, deps).pipe(
    Effect.provide(context),
  );
});

/** Drive one registered handler with the source id and wait for its run to end. */
const dispatch = Effect.fn("dispatch")(function* (
  action: string,
  query: Record<string, string> = {},
) {
  const handler = handlers.get(action);
  if (!handler) return yield* Effect.die(`no handler for ${action}`);
  const fiber = handler(
    protocolData(action, { "source-id": SOURCE_ID, ...query }),
  );
  if (!Fiber.isFiber(fiber)) return yield* Effect.die("no handler fiber");
  return yield* Fiber.join(fiber);
});

beforeEach(() => {
  handlers.clear();
  shownInLibrary.length = 0;
  vi.mocked(runBatchUpdate).mockClear();
  vi.mocked(runBatchUpdateAll).mockClear();
  openBatchModal.mockReset();
  reads.Libraries.mockClear();
  reads.ScopeItemIDs.mockClear();
  reads.DisplayRefs.mockReset();
  reads.AttachmentsAt.mockReset();
  vi.mocked(openCompanionNote).mockClear();
  vi.mocked(openTemplateWorkbench).mockClear();
  vi.mocked(openTemplateDataExplorer).mockClear();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
});

describe("single-note protocol links", () => {
  it.effect.each(["open", "update"] as const)(
    "routes %s through the shared Companion flow with its URL Profile",
    (action) =>
      Effect.gen(function* () {
        refOf(REF);
        yield* register();
        yield* dispatch(`zotlit/${action}`, {
          item: "1",
          profile: "Bk3Qn7XvT2Lp",
        });
        expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          ITEM_REF,
          { action, profile: "Bk3Qn7XvT2Lp", scope: "full" },
        );
      }),
  );
});

describe("paneType", () => {
  it.effect("routes an explore link's paneType to the explorer", () =>
    Effect.gen(function* () {
      refOf(REF);
      const app = appStub();
      yield* register({ deps: { app } });
      yield* dispatch("zotlit/explore", { item: "1", paneType: "window" });
      expect(openTemplateDataExplorer).toHaveBeenCalledExactlyOnceWith(
        app,
        { itemIndexedKey: "ABCD2345", anchorAnnotationKey: undefined },
        { paneType: "window" },
      );
    }),
  );

  it.effect("routes the link's paneType to the Companion flow", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();
      yield* dispatch("zotlit/open", { item: "1", paneType: "split" });
      expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        ITEM_REF,
        { action: "open", scope: "full", paneType: "split" },
      );
    }),
  );
});

describe("show-in-library protocol link", () => {
  it.effect("shows the Item its Indexed Key names in the Library View", () =>
    Effect.gen(function* () {
      yield* register();
      const outcome = yield* dispatch("zotlit/show-in-library", {
        "item-key": "ABCD2345g7",
      });
      expect(shownInLibrary).toEqual(["ABCD2345g7"]);
      expect(outcome).toEqual(ProtocolOutcome.Opened());
    }),
  );

  it.effect("refuses a link whose key is not an Indexed Key", () =>
    Effect.gen(function* () {
      yield* register();
      const outcome = yield* dispatch("zotlit/show-in-library", {
        "item-key": "not a key",
      });
      expect(shownInLibrary).toEqual([]);
      expect(outcome).toEqual(ProtocolOutcome.InvalidLink());
    }),
  );
});

describe("open-attachment protocol link", () => {
  const app = appStub();
  const opener = {
    open: vi.fn(() => Effect.succeed({ kind: "reader" as const })),
  };
  beforeEach(() => opener.open.mockClear());

  /** Register with the Attachment opener and the App the reader gets. */
  const registerOpener = (state?: ZoteroReadsState["state"]) =>
    register({
      deps: {
        app,
        // The picker's opens run here; each case reads the open it asked for.
        bridge: stubService<ProtocolDeps["bridge"]>("EffectBridge", {
          runAndForget: () => {},
        }),
      },
      opener,
      state,
    });

  it.effect("treats the id as the Attachment itself when it names one", () =>
    Effect.gen(function* () {
      const attachment = attachmentOf(9);
      attachmentsAt([attachment]);
      vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
        openableAttachment("ATCH1"),
      ]);
      yield* registerOpener();

      yield* dispatch("zotlit/open-attachment", { item: "9" });

      expect(toObsidianOpenableAttachments).toHaveBeenCalledExactlyOnceWith(
        [attachment],
        {
          pathContext: { dataDir: "/data", baseAttachmentPath: null },
          vaultBasePath: "/vault",
          platform: process.platform,
        },
      );
      expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({
        itemID: 9,
      });
    }),
  );

  it.effect(
    "falls back to the item's own Attachments when the id names a regular item",
    () =>
      Effect.gen(function* () {
        const attachment = attachmentOf(2);
        attachmentsAt([attachment]);
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
          openableAttachment("ATCH2"),
        ]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "42" });

        expect(toObsidianOpenableAttachments).toHaveBeenCalledWith(
          [attachment],
          expect.anything(),
        );
        expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({
          itemID: 42,
        });
      }),
  );

  it.effect(
    "hands an empty list to openAttachments when nothing resolves to an Obsidian-Openable Attachment, deferring the notice to the reader",
    () =>
      Effect.gen(function* () {
        attachmentsAt([]);
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "42" });

        expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
          reader: expect.anything(),
          app,
        });
      }),
  );

  it.effect("resolves no Attachments while the database is not ready", () =>
    Effect.gen(function* () {
      yield* registerOpener("loading");

      expect(yield* dispatch("zotlit/open-attachment", { item: "9" })).toEqual(
        ProtocolOutcome.DatabaseUnavailable(),
      );

      expect(reads.AttachmentsAt).not.toHaveBeenCalled();
      expect(openAttachments).not.toHaveBeenCalled();
    }),
  );

  it.effect("offers no event, so the picker is always the Suggest modal", () =>
    Effect.gen(function* () {
      attachmentsAt([attachmentOf(9)]);
      const opened = openableAttachment("ATCH1");
      vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
      yield* registerOpener();

      yield* dispatch("zotlit/open-attachment", { item: "9" });

      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([opened], {
        reader: expect.anything(),
        app,
      });
    }),
  );

  it.effect(
    "opens a picked row in the pane the pick asked for when the link names none",
    () =>
      Effect.gen(function* () {
        attachmentsAt([attachmentOf(9)]);
        const opened = openableAttachment("ATCH1");
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "9" });

        expect(openAttachments).toHaveBeenCalledOnce();
        const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
        reader.open(opened, "tab");
        expect(opener.open).toHaveBeenCalledExactlyOnceWith(
          { kind: "attachment", attachmentKey: "ATCH1" },
          "tab",
        );
      }),
  );

  it.effect(
    "honors the link's paneType even for a single Attachment that would open directly",
    () =>
      Effect.gen(function* () {
        attachmentsAt([attachmentOf(9)]);
        const opened = openableAttachment("ATCH1");
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", {
          item: "9",
          paneType: "split",
        });

        expect(openAttachments).toHaveBeenCalledOnce();
        const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
        reader.open(opened, false);
        expect(opener.open).toHaveBeenCalledExactlyOnceWith(
          { kind: "attachment", attachmentKey: "ATCH1" },
          "split",
        );
      }),
  );
});

describe("layerProtocolHandlers", () => {
  it.effect(
    "registers the handlers on the plugin host, and runs them on the layer's services",
    () =>
      Effect.gen(function* () {
        const host = testPluginHost({
          registerObsidianProtocolHandler: (action, handler) => {
            handlers.set(action, handler);
          },
        });
        yield* Layer.build(
          layerProtocolHandlers(
            stubService<Omit<ProtocolDeps, "bridge">>("ProtocolDeps", {
              webWorkbenchEnabled: true,
              noteImportView,
              app: appStub(),
            }),
          ).pipe(Layer.provide(Layer.merge(host.layer, servicesFor()))),
        );

        yield* dispatch("zotlit/update-all");

        expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ view: noteImportView }),
          { groupID: 0, collectionKey: undefined },
        );
      }),
  );
});

describe("library-wide protocol links", () => {
  it.effect("passes the named group as an exact update target", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/update-all", {
        library: "7",
        collection: "ABCD2345",
      });

      expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { groupID: 7, collectionKey: "ABCD2345" },
      );
    }),
  );

  it.effect("keeps a link without a library parameter on My Library", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/update-all");

      expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { groupID: 0, collectionKey: undefined },
      );
    }),
  );

  it.effect(
    "ends an update-all link with the outcome its update ended with",
    () =>
      Effect.gen(function* () {
        vi.mocked(runBatchUpdateAll).mockReturnValueOnce(
          Effect.succeed<BatchUpdateResult>({ outcome: "empty-selection" }),
        );
        yield* register();

        const outcome = yield* dispatch("zotlit/update-all", { library: "7" });

        expect(outcome).toEqual(
          ProtocolOutcome.UpdateAll({
            exit: Exit.succeed({ outcome: "empty-selection" }),
          }),
        );
      }),
  );

  it.effect("ends an update-all link with its update's failure", () =>
    Effect.gen(function* () {
      vi.mocked(runBatchUpdateAll).mockReturnValueOnce(
        Effect.die(new Error("classify failed")),
      );
      yield* register();

      const outcome = yield* dispatch("zotlit/update-all", { library: "7" });

      expect(
        ProtocolOutcome.$is("UpdateAll")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
    }),
  );

  it.effect("passes the named group as an exact import target", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-all-notes", {
        library: "7",
        collection: "ABCD2345",
      });

      expect(reads.ScopeItemIDs).toHaveBeenCalledExactlyOnceWith({
        kind: "notes",
        libraryID: 12,
        collectionKey: "ABCD2345",
      });
      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ total: 2 }),
      );
    }),
  );

  it.effect(
    "keeps an import link without a library parameter on My Library",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/import-all-notes");

        expect(reads.ScopeItemIDs).toHaveBeenCalledExactlyOnceWith({
          kind: "notes",
          libraryID: 1,
        });
        expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ total: 2 }),
        );
      }),
  );
});

describe("clipboard Profile protocol handoff", () => {
  const PROFILE_PATH = "templates/shared.md";
  /** The vault with the Profile document the import writes. */
  function profileVault(): { file: TFile; files: Map<string, TFile> } {
    const file = new TFile();
    file.path = PROFILE_PATH;
    return { file, files: new Map([[PROFILE_PATH, file]]) };
  }
  /** What the importer answers after the user's consent. */
  function imported(path: string) {
    return stubService<ImportedProfile>("LiteratureNoteProfile", { path });
  }

  it.effect("omits the web clipboard handoff when the build gate is off", () =>
    Effect.gen(function* () {
      yield* register({ deps: { webWorkbenchEnabled: false } });

      expect(handlers.has("zotlit/import-profile")).toBe(false);
    }),
  );

  it.effect(
    "waits for import consent and then opens the returned document",
    () =>
      Effect.gen(function* () {
        const consent = yield* Deferred.make<ImportedProfile | undefined>();
        const importProfile = vi.fn(() => Deferred.await(consent));
        const { file, files } = profileVault();
        const app = appStub();
        yield* register({ deps: { app, importProfile }, files });

        const fiber = handlers.get("zotlit/import-profile")!(
          protocolData("zotlit/import-profile", { clipboard: "true" }),
        );
        yield* Effect.yieldNow;
        expect(importProfile).toHaveBeenCalledWith({ source: "clipboard" });
        expect(openTemplateWorkbench).not.toHaveBeenCalled();

        yield* Deferred.succeed(consent, imported(file.path));
        if (!Fiber.isFiber(fiber)) return yield* Effect.die("no handler fiber");
        yield* Fiber.join(fiber);
        expect(openTemplateWorkbench).toHaveBeenCalledWith(file, {});
      }),
  );

  it.effect("hands the workbench the pane the link names", () =>
    Effect.gen(function* () {
      const { file, files } = profileVault();
      const app = appStub();
      const workspace = new MemoryWorkspace();
      yield* register({
        deps: {
          app,
          importProfile: vi.fn(() => Effect.succeed(imported(file.path))),
        },
        files,
        workspace,
      });

      yield* dispatch("zotlit/import-profile", {
        clipboard: "true",
        paneType: "split",
      });

      expect(workspace.leafRequests).toEqual(["split"]);
      expect(openTemplateWorkbench).toHaveBeenCalledWith(file, {
        leaf: expect.anything(),
      });
    }),
  );

  it.effect("leaves the editor closed after import cancellation", () =>
    Effect.gen(function* () {
      yield* register({
        deps: { importProfile: vi.fn(() => Effect.undefined) },
      });

      expect(
        yield* dispatch("zotlit/import-profile", { clipboard: "true" }),
      ).toEqual(ProtocolOutcome.ProfileImportCancelled());
      expect(openTemplateWorkbench).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "closes the import dialog and stops the handoff when the Scope closes",
    () =>
      Effect.gen(function* () {
        const opened = yield* Deferred.make<void>();
        const close = vi.fn();
        const { files } = profileVault();
        const scope = yield* Scope.make();
        yield* register({
          deps: {
            // The dialog stays open until something closes it.
            importProfile: vi.fn(() =>
              awaitModal<ImportedProfile | undefined>(() => {
                Deferred.doneUnsafe(opened, Effect.void);
                return { close };
              }),
            ),
          },
          files,
        }).pipe(Scope.provide(scope));
        const fiber = handlers.get("zotlit/import-profile")!(
          protocolData("zotlit/import-profile", { clipboard: "true" }),
        );
        if (!Fiber.isFiber(fiber)) return yield* Effect.die("no handler fiber");
        yield* Deferred.await(opened);

        yield* Scope.close(scope, Exit.void);
        const exit = yield* Fiber.await(fiber);

        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(close).toHaveBeenCalledOnce();
        expect(openTemplateWorkbench).not.toHaveBeenCalled();
      }),
  );

  it.effect.each([undefined, "false", ""])(
    "does not read clipboard without the explicit flag: %s",
    (clipboard) =>
      Effect.gen(function* () {
        const importProfile = vi.fn(() => Effect.undefined);
        yield* register({ deps: { importProfile } });

        const outcome = yield* dispatch(
          "zotlit/import-profile",
          clipboard === undefined ? {} : { clipboard },
        );

        expect(outcome).toEqual(ProtocolOutcome.InvalidLink());

        expect(importProfile).not.toHaveBeenCalled();
      }),
  );
});

describe("refused protocol links", () => {
  it.effect("reads no item for a query that does not parse", () =>
    Effect.gen(function* () {
      yield* register();

      expect(yield* dispatch("zotlit/open", { item: "x" })).toEqual(
        ProtocolOutcome.InvalidLink(),
      );

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
    }),
  );

  it.effect("ignores a link from another Zotero", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();

      expect(
        yield* dispatch("zotlit/open", { item: "1", "source-id": "ffff0000" }),
      ).toEqual(ProtocolOutcome.ForeignSource());

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("reads no item when the database is not ready", () =>
    Effect.gen(function* () {
      yield* register({ state: "degraded" });

      expect(yield* dispatch("zotlit/open", { item: "1" })).toEqual(
        ProtocolOutcome.DatabaseUnavailable(),
      );

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
    }),
  );

  it.effect("opens no note for an id with no live item", () =>
    Effect.gen(function* () {
      yield* register();

      expect(yield* dispatch("zotlit/open", { item: "5" })).toEqual(
        ProtocolOutcome.ItemNotFound(),
      );

      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("refuses a pushed Profile ID that names no Profile", () =>
    Effect.gen(function* () {
      const requests = yield* PubSub.unbounded<UpdateManyRequest>();
      const registration = yield* register({
        updateManyRequests: Stream.fromPubSub(requests),
      });
      const outcome = yield* Stream.runHead(registration.outcomes).pipe(
        Effect.forkChild({ startImmediately: true }),
      );

      yield* PubSub.publish(requests, {
        items: [1, 2],
        scope: "full",
        profileId: "not-a-profile",
      });

      expect(yield* Fiber.join(outcome)).toEqual(
        Option.some(ProtocolOutcome.UnknownProfile({ text: "not-a-profile" })),
      );
      expect(runBatchUpdate).not.toHaveBeenCalled();
    }),
  );

  it.effect("opens no editor when the imported document is gone", () =>
    Effect.gen(function* () {
      yield* register({
        deps: {
          importProfile: vi.fn(() =>
            Effect.succeed(
              stubService<ImportedProfile>("LiteratureNoteProfile", {
                path: "templates/gone.md",
              }),
            ),
          ),
        },
      });

      expect(
        yield* dispatch("zotlit/import-profile", { clipboard: "true" }),
      ).toEqual(ProtocolOutcome.ProfileImportFailed());
      expect(openTemplateWorkbench).not.toHaveBeenCalled();
    }),
  );

  it.effect("opens no editor when a vault read dies", () =>
    Effect.gen(function* () {
      yield* register({
        deps: {
          importProfile: vi.fn(() =>
            Effect.succeed(
              stubService<ImportedProfile>("LiteratureNoteProfile", {
                path: "templates/shared.md",
              }),
            ),
          ),
        },
        getFileByPath: () => Effect.die(new Error("vault read failed")),
      });

      expect(
        yield* dispatch("zotlit/import-profile", { clipboard: "true" }),
      ).toEqual(ProtocolOutcome.ProfileImportFailed());
      expect(openTemplateWorkbench).not.toHaveBeenCalled();
    }),
  );
});

describe("batch protocol links", () => {
  it.effect(
    "hands an update-many link's ids, scope and Profile to the batch runner",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/update-many", {
          items: "3,4,3",
          scope: "metadata",
          profile: "Bk3Qn7XvT2Lp",
        });

        expect(runBatchUpdate).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ view: noteImportView }),
          [3, 4],
          { scope: "metadata", profile: "Bk3Qn7XvT2Lp" },
        );
      }),
  );

  it.effect(
    "ends an update-many link with the outcome its update ended with",
    () =>
      Effect.gen(function* () {
        vi.mocked(runBatchUpdate).mockReturnValueOnce(
          Effect.succeed<BatchUpdateResult>({ outcome: "db-unavailable" }),
        );
        yield* register();

        const outcome = yield* dispatch("zotlit/update-many", { items: "3,4" });

        expect(outcome).toEqual(
          ProtocolOutcome.UpdateMany({
            exit: Exit.succeed({ outcome: "db-unavailable" }),
          }),
        );
      }),
  );

  it.effect("ends an update-many link with its update's failure", () =>
    Effect.gen(function* () {
      vi.mocked(runBatchUpdate).mockReturnValueOnce(
        Effect.die(new Error("classify failed")),
      );
      yield* register();

      const outcome = yield* dispatch("zotlit/update-many", { items: "3,4" });

      expect(
        ProtocolOutcome.$is("UpdateMany")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
    }),
  );

  it.effect("imports the one item an import-note link names", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-note", { item: "8", mode: "child" });

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 1,
          text: expect.objectContaining({
            title: m.batch_import_child_title(),
          }),
        }),
      );
    }),
  );

  it.effect("imports the items an import-notes link names", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-notes", { items: "8,9", mode: "note" });

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 2,
          text: expect.objectContaining({ title: m.batch_import_title() }),
        }),
      );
    }),
  );

  it.effect("opens no import while the database is not ready", () =>
    Effect.gen(function* () {
      yield* register({ state: "loading" });

      const outcome = yield* dispatch("zotlit/import-note", {
        item: "8",
        mode: "note",
      });

      expect(outcome).toEqual(
        ProtocolOutcome.ImportNotes({
          exit: Exit.succeed({ outcome: "db-unavailable" }),
        }),
      );
      expect(openBatchModal).not.toHaveBeenCalled();
    }),
  );

  it.effect("ends a link import with the failure its run ended with", () =>
    Effect.gen(function* () {
      yield* register({ whenIndexed: Effect.die(new Error("index failed")) });

      const outcome = yield* dispatch("zotlit/import-note", {
        item: "8",
        mode: "note",
      });

      expect(
        ProtocolOutcome.$is("ImportNotes")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
      expect(openBatchModal).not.toHaveBeenCalled();
    }),
  );
});

describe("requests pushed over the Local Server", () => {
  it.effect("runs a pushed batch update with its scope and Profile", () =>
    Effect.gen(function* () {
      const registration = yield* register({
        updateManyRequests: Stream.make<[UpdateManyRequest]>({
          items: [5, 6],
          scope: "full",
          profileId: "Bk3Qn7XvT2Lp",
        }),
      });

      yield* registration.idle;

      expect(runBatchUpdate).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        [5, 6],
        { scope: "full", profile: "Bk3Qn7XvT2Lp" },
      );
    }),
  );

  it.effect("runs a pushed batch import", () =>
    Effect.gen(function* () {
      const registration = yield* register({
        importNotesRequests: Stream.make<[ImportNotesRequest]>({
          items: [7, 8],
          mode: "note",
        }),
      });

      yield* registration.idle;

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 2,
          text: expect.objectContaining({ title: m.batch_import_title() }),
        }),
      );
    }),
  );

  it.effect("starts no run for a request pushed after the Scope closes", () =>
    Effect.gen(function* () {
      const requests = yield* PubSub.unbounded<UpdateManyRequest>();
      const scope = yield* Scope.make();
      const registration = yield* register({
        updateManyRequests: Stream.fromPubSub(requests),
      }).pipe(Scope.provide(scope));
      const request: UpdateManyRequest = { items: [5], scope: "full" };
      const ran = yield* Deferred.make<void>();
      vi.mocked(runBatchUpdate).mockImplementationOnce(() =>
        Effect.sync((): BatchUpdateResult => {
          Deferred.doneUnsafe(ran, Effect.void);
          return { outcome: "batch-modal" };
        }),
      );
      yield* PubSub.publish(requests, request);
      yield* Deferred.await(ran);

      yield* Scope.close(scope, Exit.void);
      yield* PubSub.publish(requests, request);
      yield* registration.idle;

      expect(runBatchUpdate).toHaveBeenCalledOnce();
    }),
  );
});
