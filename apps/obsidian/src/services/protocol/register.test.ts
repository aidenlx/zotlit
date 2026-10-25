import { Effect, Stream } from "effect";
import { TFile } from "obsidian";
import type {
  App,
  FileSystemAdapter,
  ObsidianProtocolData,
  WorkspaceLeaf,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attachment, getItemDisplayRefByID } from "@zotlit/db";

import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { openAttachments } from "@/lib/attachment-open";
import { effectBridge } from "@/lib/effect-bridge";
import { toObsidianOpenableAttachments } from "@/services/attachment-open/resolve";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import type { LocalServer } from "@/services/local-server/service";
import { openCompanionNote } from "@/services/note-feature";
import { runBatchUpdateAll } from "@/services/note-feature/update-batch";
import type { BatchImportResult } from "@/services/note-import/batch-import";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { registerProtocolHandlers } from "./register";
import type { ProtocolDeps } from "./register";

vi.mock("@/services/note-feature/update-batch", () => ({
  runBatchUpdate: vi.fn(async () => ({ outcome: "batch-modal" })),
  runBatchUpdateAll: vi.fn(async () => ({ outcome: "batch-modal" })),
}));

vi.mock("@/services/note-feature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/note-feature")>()),
  openCompanionNote: vi.fn(),
}));

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
  openTemplateWorkbench: vi.fn(),
}));

vi.mock("@/views/template-data-explorer/register", () => ({
  openTemplateDataExplorer: vi.fn(),
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
const readsApi = stubService<ProtocolDeps["zoteroReads"]["reads"]>(
  "ZoteroReadsApi",
  {
    DisplayRefs: ((input, options) =>
      options === undefined
        ? reads.DisplayRefs(input)
        : reads.DisplayRefs(input, options)) as ZoteroReadsApi["DisplayRefs"],
    AttachmentsAt: ((input, options) =>
      options === undefined
        ? reads.AttachmentsAt(input)
        : reads.AttachmentsAt(
            input,
            options,
          )) as ZoteroReadsApi["AttachmentsAt"],
  },
);

/** The reads dependency in `state`, answering through {@link reads}. */
function readsIn(state: "loading" | "ready" | "degraded" = "ready") {
  return stubService<ProtocolDeps["zoteroReads"]>("ZoteroReads", {
    state,
    reads: readsApi,
  });
}

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
const handlers = new Map<string, (data: ObsidianProtocolData) => void>();

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

function register(overrides: Partial<ProtocolDeps> = {}): Disposable {
  const plugin = {
    registerObsidianProtocolHandler: (
      action: string,
      handler: (data: ObsidianProtocolData) => void,
    ) => {
      handlers.set(action, handler);
    },
  };
  const app =
    overrides.app ??
    appStub({
      metadataCache: stubService<App["metadataCache"]>("MetadataCache", {}),
    });
  if (!("metadataCache" in app))
    Object.defineProperty(app, "metadataCache", {
      value: stubService<App["metadataCache"]>("MetadataCache", {}),
    });
  const deps = stubService<ProtocolDeps>("ProtocolDeps", {
    webWorkbenchEnabled: true,
    zoteroPref: {
      sourceId: SOURCE_ID,
      dataDir: "/data",
      baseAttachmentPath: null,
    },
    settings: stubService<ProtocolDeps["settings"]>("PluginSettings", {
      current: Effect.succeed(defaults),
    }),
    batchImport: { runBatchImport: vi.fn(), runBatchImportAll },
    liveUpdate: stubService<LocalServer["Service"]>("LocalServer", {
      updateManyRequests: Stream.empty,
      importNotesRequests: Stream.empty,
    }),
    bridge: effectBridge(testRuntime()),
    zoteroReads: readsIn(),
    ...overrides,
    app,
  });
  deps.profile = profileReader(
    () => ({ ...defaults, ...deps.bridge.runSync(deps.settings.current) }),
    deps.app?.metadataCache,
  );
  return registerProtocolHandlers(plugin, deps);
}

/** Drive one registered handler and wait for its async work to settle. */
async function dispatch(
  action: string,
  query: Record<string, string>,
): Promise<void> {
  const handler = handlers.get(action);
  if (!handler) throw new Error(`no handler for ${action}`);
  handler(protocolData(action, { "source-id": SOURCE_ID, ...query }));
  await vi.waitFor(() => {
    expect(
      vi.mocked(runBatchUpdateAll).mock.calls.length +
        runBatchImportAll.mock.calls.length,
    ).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  handlers.clear();
  vi.mocked(runBatchUpdateAll).mockClear();
  runBatchImportAll.mockClear();
  reads.DisplayRefs.mockReset();
  reads.AttachmentsAt.mockReset();
  vi.mocked(openCompanionNote).mockReset();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
});

describe("single-note protocol links", () => {
  it.each(["open", "update"] as const)(
    "routes %s through the shared Companion flow with its URL Profile",
    async (action) => {
      refOf(REF);
      using _handlers = register({
        zoteroReads: readsIn(),
      });
      handlers.get(`zotlit/${action}`)?.(
        protocolData(`zotlit/${action}`, {
          item: "1",
          profile: "Bk3Qn7XvT2Lp",
          "source-id": SOURCE_ID,
        }),
      );
      await vi.waitFor(() =>
        expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          ITEM_REF,
          { action, profile: "Bk3Qn7XvT2Lp", scope: "full" },
        ),
      );
    },
  );
});

describe("paneType", () => {
  it("routes an explore link's paneType to the explorer", async () => {
    refOf(REF);
    const app = appStub();
    using _handlers = register({
      app,
      zoteroReads: readsIn(),
    });
    handlers.get("zotlit/explore")?.(
      protocolData("zotlit/explore", {
        item: "1",
        paneType: "window",
        "source-id": SOURCE_ID,
      }),
    );
    await vi.waitFor(() =>
      expect(openTemplateDataExplorer).toHaveBeenCalledExactlyOnceWith(
        app,
        { itemIndexedKey: "ABCD2345", anchorAnnotationKey: undefined },
        { paneType: "window" },
      ),
    );
  });

  it("routes the link's paneType to the Companion flow", async () => {
    refOf(REF);
    using _handlers = register({
      zoteroReads: readsIn(),
    });
    handlers.get("zotlit/open")?.(
      protocolData("zotlit/open", {
        item: "1",
        paneType: "split",
        "source-id": SOURCE_ID,
      }),
    );
    await vi.waitFor(() =>
      expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        ITEM_REF,
        { action: "open", scope: "full", paneType: "split" },
      ),
    );
  });
});

describe("open-attachment protocol link", () => {
  const app = appStub({
    vault: stubService<App["vault"]>("Vault", {
      adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
        getBasePath: () => "/vault",
      }),
    }),
  });

  function baseDeps(
    overrides: Partial<ProtocolDeps> = {},
  ): Partial<ProtocolDeps> {
    return {
      app,
      zoteroReads: readsIn(),
      zoteroPref: {
        sourceId: SOURCE_ID,
        dataDir: "/data",
        baseAttachmentPath: null,
      },
      opener,
      ...overrides,
    };
  }

  const opener = {
    open: vi.fn(() => Promise.resolve({ kind: "reader" as const })),
  };
  beforeEach(() => opener.open.mockClear());

  it("treats the id as the Attachment itself when it names one", async () => {
    const attachment = attachmentOf(9);
    attachmentsAt([attachment]);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      openableAttachment("ATCH1"),
    ]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "9",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() =>
      expect(toObsidianOpenableAttachments).toHaveBeenCalledWith(
        [attachment],
        expect.anything(),
      ),
    );
    expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({ itemID: 9 });
  });

  it("falls back to the item's own Attachments when the id names a regular item", async () => {
    const attachment = attachmentOf(2);
    attachmentsAt([attachment]);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      openableAttachment("ATCH2"),
    ]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "42",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() =>
      expect(toObsidianOpenableAttachments).toHaveBeenCalledWith(
        [attachment],
        expect.anything(),
      ),
    );
    expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({
      itemID: 42,
    });
  });

  it("hands an empty list to openAttachments when nothing resolves to an Obsidian-Openable Attachment, deferring the notice to the reader", async () => {
    attachmentsAt([]);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "42",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        app,
      }),
    );
  });

  it("shows the db-unavailable notice instead of resolving Attachments", () => {
    using _handlers = register(baseDeps({ zoteroReads: readsIn("loading") }));

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "9",
        "source-id": SOURCE_ID,
      }),
    );

    expect(reads.AttachmentsAt).not.toHaveBeenCalled();
    expect(openAttachments).not.toHaveBeenCalled();
  });

  it("offers no event, so the picker is always the Suggest modal", async () => {
    attachmentsAt([attachmentOf(9)]);
    const opened = openableAttachment("ATCH1");
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "9",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([opened], {
        reader: expect.anything(),
        app,
      }),
    );
  });

  it("opens a picked row in the pane the pick asked for when the link names none", async () => {
    attachmentsAt([attachmentOf(9)]);
    const opened = openableAttachment("ATCH1");
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "9",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() => expect(openAttachments).toHaveBeenCalledOnce());
    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    void reader.open(opened, "tab");
    expect(opener.open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "ATCH1" },
      "tab",
    );
  });

  it("honors the link's paneType even for a single Attachment that would open directly", async () => {
    attachmentsAt([attachmentOf(9)]);
    const opened = openableAttachment("ATCH1");
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.(
      protocolData("zotlit/open-attachment", {
        item: "9",
        paneType: "split",
        "source-id": SOURCE_ID,
      }),
    );

    await vi.waitFor(() => expect(openAttachments).toHaveBeenCalledOnce());
    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    void reader.open(opened, false);
    expect(opener.open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "ATCH1" },
      "split",
    );
  });
});

describe("library-wide protocol links", () => {
  it("passes the named group as an exact update target", async () => {
    using _handlers = register();

    await dispatch("zotlit/update-all", {
      library: "7",
      collection: "ABCD2345",
    });

    expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { groupID: 7, collectionKey: "ABCD2345" },
    );
  });

  it("keeps a link without a library parameter on My Library", async () => {
    using _handlers = register();

    await dispatch("zotlit/update-all", {});

    expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { groupID: 0, collectionKey: undefined },
    );
  });

  it("passes the named group as an exact import target", async () => {
    using _handlers = register();

    await dispatch("zotlit/import-all-notes", {
      library: "7",
      collection: "ABCD2345",
    });

    expect(runBatchImportAll).toHaveBeenCalledExactlyOnceWith({
      groupID: 7,
      collectionKey: "ABCD2345",
    });
  });

  it("keeps an import link without a library parameter on My Library", async () => {
    using _handlers = register();

    await dispatch("zotlit/import-all-notes", {});

    expect(runBatchImportAll).toHaveBeenCalledExactlyOnceWith({
      groupID: 0,
      collectionKey: undefined,
    });
  });
});

describe("clipboard Profile protocol handoff", () => {
  it("omits the web clipboard handoff when the build gate is off", () => {
    using _handlers = register({ webWorkbenchEnabled: false });

    expect(handlers.has("zotlit/import-profile")).toBe(false);
  });

  it("waits for import consent and then opens the returned document", async () => {
    vi.mocked(openTemplateWorkbench).mockClear();
    const consent =
      Promise.withResolvers<
        Awaited<ReturnType<ProtocolDeps["importProfile"]>>
      >();
    const importProfile = vi.fn(() => consent.promise);
    const file = new TFile();
    file.path = "templates/shared.md";
    const app = appStub({
      vault: stubService<App["vault"]>("Vault", {
        getFileByPath: vi.fn(() => file),
      }),
    });
    using _handlers = register({ app, importProfile });
    handlers.get("zotlit/import-profile")!(
      protocolData("zotlit/import-profile", { clipboard: "true" }),
    );
    expect(importProfile).toHaveBeenCalledWith({ source: "clipboard" });
    expect(openTemplateWorkbench).not.toHaveBeenCalled();
    consent.resolve(
      stubService<
        NonNullable<Awaited<ReturnType<ProtocolDeps["importProfile"]>>>
      >("LiteratureNoteProfile", { path: file.path }),
    );
    await vi.waitFor(() =>
      expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, {}),
    );
  });
  it("hands the workbench the pane the link names", async () => {
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
    const getLeaf = vi.fn(() => leaf);
    const file = new TFile();
    file.path = "templates/shared.md";
    const app = appStub({
      vault: stubService<App["vault"]>("Vault", {
        getFileByPath: vi.fn(() => file),
      }),
      workspace: stubService<App["workspace"]>("Workspace", { getLeaf }),
    });
    using _handlers = register({
      app,
      importProfile: vi.fn(async () =>
        stubService<
          NonNullable<Awaited<ReturnType<ProtocolDeps["importProfile"]>>>
        >("LiteratureNoteProfile", { path: file.path }),
      ),
    });
    handlers.get("zotlit/import-profile")!(
      protocolData("zotlit/import-profile", {
        clipboard: "true",
        paneType: "split",
      }),
    );
    await vi.waitFor(() =>
      expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, { leaf }),
    );
    expect(getLeaf).toHaveBeenCalledExactlyOnceWith("split");
  });

  it("leaves the editor closed after import cancellation", async () => {
    vi.mocked(openTemplateWorkbench).mockClear();
    const importProfile = vi.fn(async () => undefined);
    using _handlers = register({ importProfile });
    handlers.get("zotlit/import-profile")!(
      protocolData("zotlit/import-profile", { clipboard: "true" }),
    );
    await Promise.resolve();
    expect(openTemplateWorkbench).not.toHaveBeenCalled();
  });
  it.each([undefined, "false", ""])(
    "does not read clipboard without the explicit flag: %s",
    (clipboard) => {
      const importProfile = vi.fn(async () => undefined);
      using _handlers = register({ importProfile });
      handlers.get("zotlit/import-profile")!(
        protocolData(
          "zotlit/import-profile",
          clipboard === undefined ? {} : { clipboard },
        ),
      );
      expect(importProfile).not.toHaveBeenCalled();
    },
  );
});
