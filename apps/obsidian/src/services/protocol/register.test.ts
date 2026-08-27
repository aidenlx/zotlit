import type { ObsidianProtocolData } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemRefByID } from "@zotlit/db";

import { BaseNotice } from "@/lib/notice";
import { runBatchUpdateAll } from "@/services/note-feature/update-batch";
import { createAndOpen } from "@/services/note-feature/update-single";

import { registerProtocolHandlers } from "./register";
import type { ProtocolDeps } from "./register";

vi.mock("@/services/note-feature/update-batch", () => ({
  runBatchUpdate: vi.fn(async () => ({ outcome: "batch-modal" })),
  runBatchUpdateAll: vi.fn(async () => ({ outcome: "batch-modal" })),
}));

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getItemRefByID: vi.fn(),
}));

vi.mock("@/lib/notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notice")>()),
  BaseNotice: vi.fn(),
}));

vi.mock("@/services/note-feature/update-single", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/note-feature/update-single")
  >()),
  createAndOpen: vi.fn(),
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
    zoteroPref: { sourceId: SOURCE_ID },
    batchImport: { runBatchImport: vi.fn(), runBatchImportAll },
    liveUpdate: { on: () => () => {} },
    ...overrides,
  } as unknown as ProtocolDeps;
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
  vi.mocked(createAndOpen).mockReset();
  vi.mocked(BaseNotice).mockClear();
});

describe("single-note protocol links", () => {
  it("refuses to open an existing note with a different explicit Profile", async () => {
    const requestedProfileId = "93f0df01-9de9-47e6-aa12-1ff770c1ab86";
    const existing = { path: "Literature/Existing.md" };
    const openLinkText = vi.fn(async () => {});
    vi.mocked(getItemRefByID).mockReturnValue({
      indexedKey: "ABC12345",
    } as ReturnType<typeof getItemRefByID>);
    using _handlers = register({
      db: { state: "ready", client: {} },
      noteIndex: {
        whenIndexed: async () => {},
        getNotesByItemKey: () => [existing],
      },
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: {
              "zotlit-profile": "36c4f8b4-4f65-4cab-8c51-c921ea616cc8",
            },
          }),
        },
        workspace: { openLinkText },
      },
    } as unknown as Partial<ProtocolDeps>);

    handlers.get("zotlit/open")?.({
      action: "zotlit/open",
      item: "1",
      profile: requestedProfileId,
      "source-id": SOURCE_ID,
    } as ObsidianProtocolData);

    await vi.waitFor(() => expect(BaseNotice).toHaveBeenCalled());
    expect(openLinkText).not.toHaveBeenCalled();
    expect(createAndOpen).not.toHaveBeenCalled();
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
