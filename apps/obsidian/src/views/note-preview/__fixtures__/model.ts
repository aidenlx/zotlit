// A preview model host with driven Zotero events and interruptible snapshot reads.
import { Effect, Layer, Queue, Stream } from "effect";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { makeViewRegistry } from "@/lib/view-atoms";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";
import { holdPreviewModel, makePreviewModel, patchPreview } from "@/views/note-preview/model";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

export async function makePreviewHost() {
  const stack = new AsyncDisposableStack();
  const observers = new Set<() => void>();
  const started: string[] = [];
  const cancelled: string[] = [];
  const runtime = buildRuntime(Layer.mergeAll(
    layerUnreadViewServices,
    layerHost(),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
      snapshot: Effect.succeed(stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
        ItemSnapshot: (request) => Effect.promise((signal) => {
            const key = request.selection.key;
            started.push(key);
            signal.addEventListener("abort", () => cancelled.push(key));
            return new Promise<never>(() => {});
          }),
      })),
      events: Stream.callback<ZoteroReadsEvent>((queue) => Effect.acquireRelease(
        Effect.sync(() => {
          const send = () => { Queue.offerUnsafe(queue, { _tag: "changed" }); };
          observers.add(send);
          return send;
        }),
        (send) => Effect.sync(() => observers.delete(send)),
      )),
    }),
  ), stack);
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry, started, cancelled,
    changeZotero: () => { for (const send of observers) send(); },
    subscribers: () => observers.size,
    open: (id: string) => {
      const model = makePreviewModel();
      const release = holdPreviewModel(registry, model);
      registry.update(model.input, patchPreview({ item: { id, title: null } }));
      return {
        model,
        state: () => registry.get(model.state),
        ready: () => waitFor(() => { if (registry.get(model.loaded).waiting) throw new Error("Preview data is loading"); }),
        [Symbol.dispose]: release,
      };
    },
    async [Symbol.asyncDispose]() { registry.dispose(); await stack.disposeAsync(); },
  };
}
