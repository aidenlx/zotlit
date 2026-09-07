import type { ObsidianProtocolData } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemRefByID } from "@zotlit/db";

import { openCompanionNote } from "@/services/note-feature";
import { runBatchUpdateAll } from "@/services/note-feature/update-batch";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";

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

vi.mock("@/services/note-feature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/note-feature")>()),
  openCompanionNote: vi.fn(),
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
