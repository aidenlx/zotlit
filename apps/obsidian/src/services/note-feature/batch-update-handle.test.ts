// The edge handle is a Promise API on purpose: these cases call it as the
// update-all command and the Workbench's saved notice do.
import { Effect, Layer, ManagedRuntime } from "effect";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Library } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { Notifier } from "@/lib/notifier";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { LibraryScope } from "@/services/library-scope/service";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";

import { bindBatchUpdate } from "./batch-update-handle";
import type { BatchUpdatePorts, BatchUpdateServices } from "./update-batch";
import { batchUpdateNotices } from "./update-single";

const GROUP_LIBRARY: Library = {
  libraryID: 12,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

/** A Reading group that holds no Item. */
const GROUP_READS = readsAnswering({
  Libraries: () => Effect.succeed([GROUP_LIBRARY]),
  ScopeItemIDs: () => Effect.succeed([]),
});

/** The plugin services an update-all of the Reading group reads. */
function services(
  snapshot: Effect.Effect<ZoteroReadsApi>,
): Layer.Layer<BatchUpdateServices> {
  return Layer.mergeAll(
    Layer.mock(LibraryScope, {}),
    Layer.mock(MetadataCache, {}),
    Layer.mock(NoteIndex, {}),
    Layer.mock(Notifier, {}),
    Layer.mock(PluginSettings, {}),
    Layer.mock(Profile, {}),
    Layer.mock(Workspace, {}),
    Layer.mock(ZoteroReads, {
      current: Effect.succeed(
        stubService<ZoteroReadsState>("ZoteroReadsState", { state: "ready" }),
      ),
      reads: GROUP_READS,
      snapshot,
    }),
  );
}

/** The handle over `layer`, bound as `build.ts` binds it. */
function handleOver(layer: Layer.Layer<BatchUpdateServices>) {
  const runtime = ManagedRuntime.make(layer);
  const bridge = effectBridge(runtime);
  const ports: Omit<BatchUpdatePorts, "bridge"> = {
    notices: batchUpdateNotices(stubService<App>("App", {})),
    view: stubService<BatchUpdatePorts["view"]>("NoteImportView", {
      openBatchModal: vi.fn(),
    }),
    noteFeature: stubService<BatchUpdatePorts["noteFeature"]>(
      "NoteFeature",
      {},
    ),
  };
  const handle = bindBatchUpdate(
    bridge,
    runtime.runSync(Effect.context<BatchUpdateServices>()),
    ports,
  );
  return { runtime, bridge, handle };
}

/** How a Promise settled, so two settlements compare. */
function settled(promise: Promise<unknown>) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

it("resolves with the outcome of the update", async () => {
  const { runtime, handle } = handleOver(services(Effect.succeed(GROUP_READS)));

  await expect(handle.runBatchUpdateAll({ groupID: 7 })).resolves.toEqual({
    outcome: "empty-selection",
  });
  await runtime.dispose();
});

it("settles a pending update after the runtime is disposed, as the bridge does", async () => {
  const opened = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const snapshot = Effect.promise(async () => {
    opened.resolve();
    await gate.promise;
    return GROUP_READS;
  });
  const { runtime, bridge, handle } = handleOver(services(snapshot));

  const pending = settled(handle.runBatchUpdateAll({ groupID: 7 }));
  await opened.promise;
  // A run of the same wait through the bridge itself, for comparison.
  const probe = settled(bridge.runPromise(snapshot.pipe(Effect.as("probe"))));
  await runtime.dispose();
  gate.resolve();

  const [update, bridged] = await Promise.all([pending, probe]);
  expect(update.status).toBe(bridged.status);
  expect(update).toEqual({
    status: "fulfilled",
    value: { outcome: "empty-selection" },
  });
});
