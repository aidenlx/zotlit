// An in-memory `data.json`.
import { Effect, Layer } from "@/lib/effect";
import { PluginData } from "@/lib/plugin-data";

/** Plugin data held in memory, with every value saved to it. */
export function testPluginData(initial: unknown = null) {
  const store = { current: initial, saved: [] as unknown[] };
  const service = PluginData.of({
    load: Effect.sync(() => structuredClone(store.current)),
    save: (data) =>
      Effect.sync(() => {
        store.current = structuredClone(data);
        store.saved.push(store.current);
      }),
  });
  return { store, service, layer: Layer.succeed(PluginData, service) };
}
