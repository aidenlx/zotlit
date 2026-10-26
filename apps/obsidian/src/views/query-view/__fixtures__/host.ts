// A Query View test registry over in-memory host services and controlled query reads.
import { Layer } from "effect";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { makeViewRegistry } from "@/lib/view-atoms";

export async function makeQueryHost() {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(Layer.mergeAll(layerUnreadViewServices, layerHost()), stack);
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
