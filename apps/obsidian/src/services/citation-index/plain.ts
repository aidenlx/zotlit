/** Citation Lookup for views and legacy services, on the plugin runtime. */
import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import { CitationLookup, inertObservation } from "./lookup-service";
import type {
  CitationLookupObservation,
  CitationLookupState,
  CitationLookupStatus,
} from "./lookup-service";

export interface PlainCitationLookup {
  readonly status: CitationLookupStatus;
  readonly changes: Stream.Stream<CitationLookupState>;
  read(
    request: CitationLookupRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CitationLookupAnswer>;
  observe(changed: () => void): CitationLookupObservation;
  whenResolved(): Promise<void>;
  subscribe(callback: (state: CitationLookupState) => void): () => void;
  on(event: "changed" | "status-changed", callback: () => void): () => void;
}

export function plainCitationLookup(
  runtime: ManagedRuntime.ManagedRuntime<CitationLookup, never>,
): PlainCitationLookup {
  const service = runtime.runSync(CitationLookup);
  const run = Effect.runSyncWith(runtime.runSync(Effect.context<never>()));
  const closed = () => runtime.scope.state._tag === "Closed";
  const released = () =>
    new DOMException("Citation Lookup released", "AbortError");
  const subscribeChanges = (callback: (state: CitationLookupState) => void) => {
    const seen = run(service.current);
    return subscribe(
      runtime,
      Stream.dropWhile(service.changes, (next) => next === seen),
      callback,
    );
  };
  return {
    get status() {
      return run(service.current).status;
    },
    changes: service.changes,
    async read(request, { signal } = {}) {
      if (closed()) throw released();
      // Capture the caller's selection before crossing the async runtime boundary.
      const selected = {
        citekeys: [...(request.citekeys ?? [])],
        indexedKeys: [...(request.indexedKeys ?? [])],
        annotationKeys: [...(request.annotationKeys ?? [])],
      };
      const exit = await runtime.runPromiseExit(service.read(selected), {
        signal,
      });
      if (Exit.isSuccess(exit)) return exit.value;
      if (closed() || Cause.hasInterruptsOnly(exit.cause)) throw released();
      throw Cause.squash(exit.cause);
    },
    observe: (changed) =>
      closed() ? inertObservation() : runtime.runSync(service.observe(changed)),
    async whenResolved() {
      if (!closed()) await runtime.runPromiseExit(service.whenResolved());
    },
    subscribe: subscribeChanges,
    on(event, callback) {
      let before = run(service.current);
      return subscribeChanges((next) => {
        const previous = before;
        before = next;
        if (
          event === "changed"
            ? previous.revision !== next.revision
            : previous.status !== next.status
        )
          callback();
      });
    },
  };
}
