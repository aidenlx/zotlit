import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TFile } from "obsidian";
import type { App, ObsidianProtocolData } from "obsidian";
import { beforeEach, describe, expect, vi } from "vitest";

import type { Attachment, getItemDisplayRefByID } from "@zotlit/db";

import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { openAttachments } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import { Vault } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { toObsidianOpenableAttachments } from "@/services/attachment-open/resolve";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import { LocalServer } from "@/services/local-server/service";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@/services/local-server/service";
import { openCompanionNote } from "@/services/note-feature";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@/services/note-feature/update-batch";
import type { BatchImportResult } from "@/services/note-import/batch-import";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { registerProtocolHandlers } from "./register";
import type { ProtocolDeps } from "./register";

/** Every text notice a handler showed, in order, and a hook on each one. */
const notices = vi.hoisted(() => ({
  shown: [] as string[],
  onShow: undefined as (() => void) | undefined,
}));
vi.mock("@/lib/notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notice")>();
  return {
    ...actual,
    BaseNotice: class extends actual.BaseNotice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        notices.shown.push(
          typeof message === "string" ? message : (message.textContent ?? ""),
        );
        notices.onShow?.();
      }
    },
  };
});

vi.mock("@/services/note-feature/update-batch", () => ({
  runBatchUpdate: vi.fn(async () => ({ outcome: "batch-modal" })),
  runBatchUpdateAll: vi.fn(async () => ({ outcome: "batch-modal" })),
}));

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

vi.mock("@/views/template-workbench/register", () => ({
  openTemplateWorkbench: vi.fn(async () => {}),
}));

vi.mock("@/views/template-data-explorer/register", () => ({
  openTemplateDataExplorer: vi.fn(async () => {}),
}));

const SOURCE_ID = "abc12345";

type ItemDisplayRef = NonNullable<ReturnType<typeof getItemDisplayRefByID>>;
type DisplayRefSlice = { itemID: number; ref: ItemDisplayRef | null }[];

/** The ZoteroReads operations the handlers call, answering what a test sets. */
const reads = {
  DisplayRefs: vi.fn(
    (
      _input: Parameters<ZoteroReadsApi["DisplayRefs"]>[0],
      _options?: Parameters<ZoteroReadsApi["DisplayRefs"]>[1],
    ) => Stream.make<DisplayRefSlice[]>([]),
  ),
  AttachmentsAt: vi.fn(
    (
      _input: Parameters<ZoteroReadsApi["AttachmentsAt"]>[0],
      _options?: Parameters<ZoteroReadsApi["AttachmentsAt"]>[1],
    ) => Effect.succeed<readonly Attachment[]>([]),
  ),
};
const readsApi = stubService<ZoteroReadsApi>("ZoteroReadsApi", {
  DisplayRefs: ((input, options) =>
    options === undefined
      ? reads.DisplayRefs(input)
      : reads.DisplayRefs(input, options)) as ZoteroReadsApi["DisplayRefs"],
  AttachmentsAt: ((input, options) =>
    options === undefined
      ? reads.AttachmentsAt(input)
      : reads.AttachmentsAt(input, options)) as ZoteroReadsApi["AttachmentsAt"],
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

const runBatchImportAll = vi.fn(async (): Promise<BatchImportResult> => ({
  outcome: "batch-modal",
}));

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
  /** The database state; `ready` by default. */
  readonly state?: ZoteroReadsState["state"];
  readonly updateManyRequests?: Stream.Stream<UpdateManyRequest>;
  readonly importNotesRequests?: Stream.Stream<ImportNotesRequest>;
  /** The vault's files, by path. */
  readonly files?: ReadonlyMap<string, TFile>;
  readonly workspace?: MemoryWorkspace;
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
    batchImport: { runBatchImport: vi.fn(), runBatchImportAll },
    app: appStub(),
    ...setup.deps,
  });
  const context = yield* Layer.build(
    Layer.mergeAll(
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
      }),
      Layer.mock(LocalServer, {
        updateManyRequests: setup.updateManyRequests ?? Stream.empty,
        importNotesRequests: setup.importNotesRequests ?? Stream.empty,
      }),
      Layer.mock(UseLedger, {}),
      Layer.mock(Vault, {
        getFileByPath: (path: string) =>
          Effect.succeed(setup.files?.get(path) ?? null),
      }),
      layerWorkspaceFrom(setup.workspace ?? new MemoryWorkspace()),
      layerTestObsidianEnv({ basePath: "/vault" }),
    ),
  );
  yield* Effect.acquireDisposable(
    registerProtocolHandlers(plugin, deps).pipe(Effect.provideContext(context)),
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
  yield* Fiber.join(fiber);
});

/** A Deferred that completes when `install` hands its callback a call. */
const signal = Effect.fn("signal")(function* (
  install: (done: () => void) => void,
) {
  const called = yield* Deferred.make<void>();
  install(() => Deferred.doneUnsafe(called, Effect.void));
  return called;
});

beforeEach(() => {
  handlers.clear();
  notices.shown.length = 0;
  notices.onShow = undefined;
  vi.mocked(runBatchUpdate).mockClear();
  vi.mocked(runBatchUpdateAll).mockClear();
  runBatchImportAll.mockClear();
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

describe("open-attachment protocol link", () => {
  const app = appStub();
  const opener = {
    open: vi.fn(() => Promise.resolve({ kind: "reader" as const })),
  };
  beforeEach(() => opener.open.mockClear());

  /** Register with the Attachment opener and the App the reader gets. */
  const registerOpener = (state?: ZoteroReadsState["state"]) =>
    register({ deps: { app, opener }, state });

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

  it.effect(
    "shows the db-unavailable notice instead of resolving Attachments",
    () =>
      Effect.gen(function* () {
        yield* registerOpener("loading");

        yield* dispatch("zotlit/open-attachment", { item: "9" });

        expect(notices.shown).toEqual([m.notice_protocol_db_unavailable()]);
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
        void reader.open(opened, "tab");
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
        void reader.open(opened, false);
        expect(opener.open).toHaveBeenCalledExactlyOnceWith(
          { kind: "attachment", attachmentKey: "ATCH1" },
          "split",
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

  it.effect("passes the named group as an exact import target", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-all-notes", {
        library: "7",
        collection: "ABCD2345",
      });

      expect(runBatchImportAll).toHaveBeenCalledExactlyOnceWith({
        groupID: 7,
        collectionKey: "ABCD2345",
      });
    }),
  );

  it.effect(
    "keeps an import link without a library parameter on My Library",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/import-all-notes");

        expect(runBatchImportAll).toHaveBeenCalledExactlyOnceWith({
          groupID: 0,
          collectionKey: undefined,
        });
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
    return stubService<
      NonNullable<Awaited<ReturnType<ProtocolDeps["importProfile"]>>>
    >("LiteratureNoteProfile", { path });
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
        const consent =
          Promise.withResolvers<
            Awaited<ReturnType<ProtocolDeps["importProfile"]>>
          >();
        const importProfile = vi.fn(() => consent.promise);
        const { file, files } = profileVault();
        const app = appStub();
        yield* register({ deps: { app, importProfile }, files });

        const fiber = handlers.get("zotlit/import-profile")!(
          protocolData("zotlit/import-profile", { clipboard: "true" }),
        );
        expect(importProfile).toHaveBeenCalledWith({ source: "clipboard" });
        expect(openTemplateWorkbench).not.toHaveBeenCalled();

        consent.resolve(imported(file.path));
        if (!Fiber.isFiber(fiber)) return yield* Effect.die("no handler fiber");
        yield* Fiber.join(fiber);
        expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, {});
      }),
  );

  it.effect("hands the workbench the pane the link names", () =>
    Effect.gen(function* () {
      const { file, files } = profileVault();
      const app = appStub();
      const workspace = new MemoryWorkspace();
      yield* register({
        deps: { app, importProfile: vi.fn(async () => imported(file.path)) },
        files,
        workspace,
      });

      yield* dispatch("zotlit/import-profile", {
        clipboard: "true",
        paneType: "split",
      });

      expect(workspace.leafRequests).toEqual(["split"]);
      expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, {
        leaf: expect.anything(),
      });
    }),
  );

  it.effect("leaves the editor closed after import cancellation", () =>
    Effect.gen(function* () {
      yield* register({
        deps: { importProfile: vi.fn(async () => undefined) },
      });

      yield* dispatch("zotlit/import-profile", { clipboard: "true" });

      expect(openTemplateWorkbench).not.toHaveBeenCalled();
      expect(notices.shown).toEqual([]);
    }),
  );

  it.effect.each([undefined, "false", ""])(
    "does not read clipboard without the explicit flag: %s",
    (clipboard) =>
      Effect.gen(function* () {
        const importProfile = vi.fn(async () => undefined);
        yield* register({ deps: { importProfile } });

        yield* dispatch(
          "zotlit/import-profile",
          clipboard === undefined ? {} : { clipboard },
        );

        expect(importProfile).not.toHaveBeenCalled();
        expect(notices.shown).toEqual([m.notice_protocol_invalid()]);
      }),
  );
});

describe("refused protocol links", () => {
  it.effect(
    "shows the invalid-link notice for a query that does not parse",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/open", { item: "x" });

        expect(notices.shown).toEqual([m.notice_protocol_invalid()]);
        expect(reads.DisplayRefs).not.toHaveBeenCalled();
      }),
  );

  it.effect("ignores a link from another Zotero without a notice", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();

      yield* dispatch("zotlit/open", { item: "1", "source-id": "ffff0000" });

      expect(notices.shown).toEqual([]);
      expect(reads.DisplayRefs).not.toHaveBeenCalled();
      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("shows the database notice when the database is not ready", () =>
    Effect.gen(function* () {
      yield* register({ state: "degraded" });

      yield* dispatch("zotlit/open", { item: "1" });

      expect(notices.shown).toEqual([m.notice_protocol_db_unavailable()]);
      expect(reads.DisplayRefs).not.toHaveBeenCalled();
    }),
  );

  it.effect("shows the not-found notice for an id with no live item", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/open", { item: "5" });

      expect(notices.shown).toEqual([m.notice_protocol_item_not_found()]);
      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("refuses a pushed Profile ID that names no Profile", () =>
    Effect.gen(function* () {
      const shown = yield* signal((done) => {
        notices.onShow = done;
      });
      yield* register({
        updateManyRequests: Stream.make<[UpdateManyRequest]>({
          items: [1, 2],
          scope: "full",
          profileId: "not-a-profile",
        }),
      });

      yield* Deferred.await(shown);

      expect(notices.shown).toHaveLength(1);
      expect(notices.shown[0]).toContain("not-a-profile");
      expect(runBatchUpdate).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "shows the Profile failure notice when the imported document is gone",
    () =>
      Effect.gen(function* () {
        yield* register({
          deps: {
            importProfile: vi.fn(async () =>
              stubService<
                NonNullable<Awaited<ReturnType<ProtocolDeps["importProfile"]>>>
              >("LiteratureNoteProfile", { path: "templates/gone.md" }),
            ),
          },
        });

        yield* dispatch("zotlit/import-profile", { clipboard: "true" });

        expect(notices.shown).toEqual([m.notice_profile_action_failed()]);
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
          expect.anything(),
          [3, 4],
          { scope: "metadata", profile: "Bk3Qn7XvT2Lp" },
        );
      }),
  );

  it.effect("imports the one item an import-note link names", () =>
    Effect.gen(function* () {
      const runBatchImport = vi.fn(async (): Promise<BatchImportResult> => ({
        outcome: "batch-modal",
      }));
      yield* register({
        deps: { batchImport: { runBatchImport, runBatchImportAll } },
      });

      yield* dispatch("zotlit/import-note", { item: "8", mode: "child" });

      expect(runBatchImport).toHaveBeenCalledExactlyOnceWith("child", [8]);
    }),
  );

  it.effect("imports the items an import-notes link names", () =>
    Effect.gen(function* () {
      const runBatchImport = vi.fn(async (): Promise<BatchImportResult> => ({
        outcome: "batch-modal",
      }));
      yield* register({
        deps: { batchImport: { runBatchImport, runBatchImportAll } },
      });

      yield* dispatch("zotlit/import-notes", { items: "8,9", mode: "note" });

      expect(runBatchImport).toHaveBeenCalledExactlyOnceWith("note", [8, 9]);
    }),
  );
});

describe("requests pushed over the Local Server", () => {
  it.effect("runs a pushed batch update with its scope and Profile", () =>
    Effect.gen(function* () {
      const called = yield* signal((done) => {
        vi.mocked(runBatchUpdate).mockImplementationOnce(async () => {
          done();
          return { outcome: "batch-modal" };
        });
      });
      yield* register({
        updateManyRequests: Stream.make<[UpdateManyRequest]>({
          items: [5, 6],
          scope: "full",
          profileId: "Bk3Qn7XvT2Lp",
        }),
      });

      yield* Deferred.await(called);

      expect(runBatchUpdate).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        [5, 6],
        { scope: "full", profile: "Bk3Qn7XvT2Lp" },
      );
    }),
  );

  it.effect("runs a pushed batch import", () =>
    Effect.gen(function* () {
      const runBatchImport = vi.fn<
        ProtocolDeps["batchImport"]["runBatchImport"]
      >(async () => ({ outcome: "batch-modal" }));
      const called = yield* signal((done) => {
        runBatchImport.mockImplementationOnce(async () => {
          done();
          return { outcome: "batch-modal" };
        });
      });
      yield* register({
        deps: { batchImport: { runBatchImport, runBatchImportAll } },
        importNotesRequests: Stream.make<[ImportNotesRequest]>({
          items: [7],
          mode: "note",
        }),
      });

      yield* Deferred.await(called);

      expect(runBatchImport).toHaveBeenCalledExactlyOnceWith("note", [7]);
    }),
  );
});
