import type { ObsidianProtocolData } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAttachmentByItemId,
  getAttachmentsByParents,
  getItemRefByID,
} from "@zotlit/db";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import { toObsidianOpenableAttachments } from "@/services/attachment-open/resolve";
import { openCompanionNote } from "@/services/note-feature";
import { runBatchUpdateAll } from "@/services/note-feature/update-batch";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { registerProtocolHandlers } from "./register";
import type { ProtocolDeps } from "./register";

vi.mock("@/services/note-feature/update-batch", () => ({
  runBatchUpdate: vi.fn(async () => ({ outcome: "batch-modal" })),
  runBatchUpdateAll: vi.fn(async () => ({ outcome: "batch-modal" })),
}));

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getItemRefByID: vi.fn(),
  getAttachmentByItemId: vi.fn(),
  getAttachmentsByParents: vi.fn(),
}));

vi.mock("@/services/note-feature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/note-feature")>()),
  openCompanionNote: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
  createObsidianAttachmentReader: vi.fn(() => ({
    icon: "file-text",
    open: vi.fn(),
  })),
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

const runBatchImportAll = vi.fn(async () => ({ outcome: "batch-modal" }));

/** Protocol handlers registered by the plugin, keyed by their action id. */
const handlers = new Map<string, (data: ObsidianProtocolData) => void>();

function register(overrides: Partial<ProtocolDeps> = {}): Disposable {
  const plugin = {
    registerObsidianProtocolHandler: (
      action: string,
      handler: (data: ObsidianProtocolData) => void,
    ) => {
      handlers.set(action, handler);
    },
  };
  const deps = {
    webWorkbenchEnabled: true,
    zoteroPref: { sourceId: SOURCE_ID },
    batchImport: { runBatchImport: vi.fn(), runBatchImportAll },
    liveUpdate: { on: () => () => {} },
    ...overrides,
  } as unknown as ProtocolDeps;
  deps.profile = profileReader(
    () => ({ ...defaults, ...deps.settings?.current }),
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
  handler({ action, "source-id": SOURCE_ID, ...query } as ObsidianProtocolData);
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
  vi.mocked(getItemRefByID).mockReset();
  vi.mocked(openCompanionNote).mockReset();
  vi.mocked(getAttachmentByItemId).mockReset();
  vi.mocked(getAttachmentsByParents).mockReset();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockClear();
});

describe("single-note protocol links", () => {
  it.each(["open", "update"] as const)(
    "routes %s through the shared Companion flow with its URL Profile",
    async (action) => {
      const ref = { indexedKey: "ABCD2345", itemID: 1 } as NonNullable<
        ReturnType<typeof getItemRefByID>
      >;
      vi.mocked(getItemRefByID).mockReturnValue(ref);
      using _handlers = register({
        db: { state: "ready", client: {} },
      } as unknown as Partial<ProtocolDeps>);
      handlers.get(`zotlit/${action}`)?.({
        action: `zotlit/${action}`,
        item: "1",
        profile: "Bk3Qn7XvT2Lp",
        "source-id": SOURCE_ID,
      } as ObsidianProtocolData);
      await vi.waitFor(() =>
        expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          ref,
          { action, profile: "Bk3Qn7XvT2Lp", scope: "full" },
        ),
      );
    },
  );
});

describe("paneType", () => {
  it("routes an explore link's paneType to the explorer", async () => {
    const ref = { indexedKey: "ABCD2345", itemID: 1 } as NonNullable<
      ReturnType<typeof getItemRefByID>
    >;
    vi.mocked(getItemRefByID).mockReturnValue(ref);
    const app = {} as ProtocolDeps["app"];
    using _handlers = register({
      app,
      db: { state: "ready", client: {} },
    } as unknown as Partial<ProtocolDeps>);
    handlers.get("zotlit/explore")?.({
      action: "zotlit/explore",
      item: "1",
      paneType: "window",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);
    await vi.waitFor(() =>
      expect(openTemplateDataExplorer).toHaveBeenCalledExactlyOnceWith(
        app,
        { itemIndexedKey: "ABCD2345", anchorAnnotationKey: undefined },
        { paneType: "window" },
      ),
    );
  });

  it("routes the link's paneType to the Companion flow", async () => {
    const ref = { indexedKey: "ABCD2345", itemID: 1 } as NonNullable<
      ReturnType<typeof getItemRefByID>
    >;
    vi.mocked(getItemRefByID).mockReturnValue(ref);
    using _handlers = register({
      db: { state: "ready", client: {} },
    } as unknown as Partial<ProtocolDeps>);
    handlers.get("zotlit/open")?.({
      action: "zotlit/open",
      item: "1",
      paneType: "split",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);
    await vi.waitFor(() =>
      expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        ref,
        { action: "open", scope: "full", paneType: "split" },
      ),
    );
  });
});

describe("open-attachment protocol link", () => {
  const app = {
    vault: { adapter: { getBasePath: () => "/vault" } },
  } as unknown as ProtocolDeps["app"];

  function baseDeps(
    overrides: Partial<ProtocolDeps> = {},
  ): Partial<ProtocolDeps> {
    return {
      app,
      db: { state: "ready", client: {} },
      zoteroPref: {
        sourceId: SOURCE_ID,
        dataDir: "/data",
        baseAttachmentPath: null,
      },
      ...overrides,
    } as unknown as Partial<ProtocolDeps>;
  }

  it("treats the id as the Attachment itself when it names one", () => {
    const attachment = { itemID: 9 };
    vi.mocked(getAttachmentByItemId).mockReturnValue(attachment as never);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      { indexedKey: "ATCH1" },
    ] as never);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "9",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    expect(getAttachmentsByParents).not.toHaveBeenCalled();
    expect(toObsidianOpenableAttachments).toHaveBeenCalledWith(
      [attachment],
      expect.anything(),
    );
  });

  it("falls back to the item's own Attachments when the id names a regular item", () => {
    vi.mocked(getAttachmentByItemId).mockReturnValue(null);
    vi.mocked(getAttachmentsByParents).mockReturnValue([
      { itemID: 2 },
    ] as never);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      { indexedKey: "ATCH2" },
    ] as never);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "42",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    expect(getAttachmentsByParents).toHaveBeenCalledWith(
      expect.anything(),
      [42],
    );
  });

  it("hands an empty list to openAttachments when nothing resolves to an Obsidian-Openable Attachment, deferring the notice to the reader", () => {
    vi.mocked(getAttachmentByItemId).mockReturnValue(null);
    vi.mocked(getAttachmentsByParents).mockReturnValue([]);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "42",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
      reader: expect.anything(),
      app,
    });
  });

  it("shows the db-unavailable notice instead of resolving Attachments", () => {
    using _handlers = register(
      baseDeps({ db: { state: "loading", client: {} } } as never),
    );

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "9",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    expect(getAttachmentByItemId).not.toHaveBeenCalled();
    expect(openAttachments).not.toHaveBeenCalled();
  });

  it("offers no event, so the picker is always the Suggest modal", () => {
    vi.mocked(getAttachmentByItemId).mockReturnValue({} as never);
    const opened = { indexedKey: "ATCH1" };
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened] as never);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "9",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    expect(openAttachments).toHaveBeenCalledExactlyOnceWith([opened], {
      reader: expect.anything(),
      app,
    });
  });

  it("passes the base reader through unchanged when the link names no pane", () => {
    vi.mocked(getAttachmentByItemId).mockReturnValue({} as never);
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
      { indexedKey: "ATCH1" },
    ] as never);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "9",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    expect(reader).toBe(
      vi.mocked(createObsidianAttachmentReader).mock.results[0]!.value,
    );
  });

  it("honors the link's paneType even for a single Attachment that would open directly", () => {
    vi.mocked(getAttachmentByItemId).mockReturnValue({} as never);
    const opened = { indexedKey: "ATCH1" };
    vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened] as never);
    using _handlers = register(baseDeps());

    handlers.get("zotlit/open-attachment")?.({
      action: "zotlit/open-attachment",
      item: "9",
      paneType: "split",
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    void reader.open(opened as never, false);
    const baseOpen = vi.mocked(createObsidianAttachmentReader).mock.results[0]!
      .value.open;
    expect(baseOpen).toHaveBeenCalledWith(opened, "split");
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
    const file = { path: "templates/shared.md" };
    const app = {
      vault: { getFileByPath: vi.fn(() => file) },
    } as unknown as ProtocolDeps["app"];
    using _handlers = register({ app, importProfile });
    handlers.get("zotlit/import-profile")!({
      action: "zotlit/import-profile",
      clipboard: "true",
    });
    expect(importProfile).toHaveBeenCalledWith({ source: "clipboard" });
    expect(openTemplateWorkbench).not.toHaveBeenCalled();
    consent.resolve({ path: file.path } as Awaited<
      ReturnType<ProtocolDeps["importProfile"]>
    >);
    await vi.waitFor(() =>
      expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, {}),
    );
  });
  it("hands the workbench the pane the link names", async () => {
    const leaf = {};
    const getLeaf = vi.fn(() => leaf);
    const file = { path: "templates/shared.md" };
    const app = {
      vault: { getFileByPath: vi.fn(() => file) },
      workspace: { getLeaf },
    } as unknown as ProtocolDeps["app"];
    using _handlers = register({
      app,
      importProfile: vi.fn(async () => ({ path: file.path })),
    } as unknown as Partial<ProtocolDeps>);
    handlers.get("zotlit/import-profile")!({
      action: "zotlit/import-profile",
      clipboard: "true",
      paneType: "split",
    } as ObsidianProtocolData);
    await vi.waitFor(() =>
      expect(openTemplateWorkbench).toHaveBeenCalledWith(app, file, { leaf }),
    );
    expect(getLeaf).toHaveBeenCalledExactlyOnceWith("split");
  });

  it("leaves the editor closed after import cancellation", async () => {
    vi.mocked(openTemplateWorkbench).mockClear();
    const importProfile = vi.fn(async () => undefined);
    using _handlers = register({ importProfile });
    handlers.get("zotlit/import-profile")!({
      action: "zotlit/import-profile",
      clipboard: "true",
    });
    await Promise.resolve();
    expect(openTemplateWorkbench).not.toHaveBeenCalled();
  });
  it.each([undefined, "false", ""])(
    "does not read clipboard without the explicit flag: %s",
    (clipboard) => {
      const importProfile = vi.fn(async () => undefined);
      using _handlers = register({ importProfile });
      handlers.get("zotlit/import-profile")!({
        action: "zotlit/import-profile",
        ...(clipboard === undefined ? {} : { clipboard }),
      });
      expect(importProfile).not.toHaveBeenCalled();
    },
  );
});
