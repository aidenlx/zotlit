/** Document citation text for the editor and reading surfaces. */
import { Cause, Effect, Exit, Stream } from "effect";
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
    async read(path: string, { signal }: { signal?: AbortSignal } = {}) {
      if (bridge.closed()) return null;
      const exit = await bridge.runPromiseExit(
        // The read is a `tryPromise`: reject with what the read rejected with.
        service.read(path).pipe(Effect.mapError(({ cause }) => cause)),
        signal === undefined ? undefined : { signal },
      );
      // The caller's signal interrupts the read and rejects with its reason.
      if (
        signal?.aborted &&
        Exit.isFailure(exit) &&
        Cause.hasInterruptsOnly(exit.cause)
      )
        throw signal.reason;
      return valueOr(exit, null);
    },
  };
}
