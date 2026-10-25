/** Document citation text for the editor and reading surfaces. */
import { Effect, Stream } from "effect";
import type { ManagedRuntime } from "effect";

import { effectBridge, valueOr } from "@/lib/effect-bridge";

import { CitationText } from "./service";

export type PlainCitationText = ReturnType<typeof plainCitationText>;

export function plainCitationText(
  runtime: ManagedRuntime.ManagedRuntime<CitationText, never>,
) {
  const bridge = effectBridge(runtime);
  const service = runtime.runSync(CitationText);
  return {
    get current() {
      return bridge.runSync(service.current);
    },
    changes: service.changes,
    events: service.events,
    changed: service.events.pipe(
      Stream.filter((event) => event.type === "changed"),
      Stream.map((event) => event.path),
    ),
    settled: service.events.pipe(
      Stream.filter((event) => event.type === "settled"),
    ),
    invalidated: service.events.pipe(
      Stream.filter((event) => event.type === "invalidated"),
      Stream.map(() => undefined),
    ),
    peek: (path: string) =>
      bridge.closed() ? null : bridge.runSync(service.peek(path)),
    async read(path: string, options?: { signal?: AbortSignal }) {
      if (bridge.closed()) return null;
      return valueOr(
        await bridge.runPromiseExit(
          // The read is a `tryPromise`: reject with what the read rejected with.
          service
            .read(path, options)
            .pipe(Effect.mapError(({ cause }) => cause)),
        ),
        null,
      );
    },
  };
}
