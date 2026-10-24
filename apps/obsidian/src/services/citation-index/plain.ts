/** Citation services for views and legacy services, on the plugin runtime. */
import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import { CitationLookup, inertObservation } from "./lookup-service";
import type {
  CitationLookupObservation,
  CitationLookupState,
  CitationLookupStatus,
} from "./lookup-service";
import { CitationIndex } from "./service";

export interface PlainCitationLookup {
  readonly status: CitationLookupStatus;
  readonly changes: Stream.Stream<CitationLookupState>;
  read(
    request: CitationLookupRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CitationLookupAnswer>;
  observe(changed: () => void): CitationLookupObservation;
  whenResolved(): Promise<void>;
  readonly changed: Stream.Stream<void>;
  readonly "status-changed": Stream.Stream<void>;
}

export function plainCitationLookup(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<CitationLookup, never>,
    "runSync"
  > &
    Pick<
      ManagedRuntime.ManagedRuntime<never, never>,
      "runPromiseExit" | "runFork" | "scope"
    >,
): PlainCitationLookup {
  const service = runtime.runSync(CitationLookup);
  const run = Effect.runSyncWith(runtime.runSync(Effect.context<never>()));
  const closed = () => runtime.scope.state._tag === "Closed";
  const released = () =>
    new DOMException("Citation Lookup released", "AbortError");
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
    changed: service.changes.pipe(
      Stream.changesWith((a, b) => a.revision === b.revision),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
    "status-changed": service.changes.pipe(
      Stream.changesWith((a, b) => a.status === b.status),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
  };
}

/** Citation Index for views and legacy services, on the plugin runtime. */

export type PlainCitationIndex = ReturnType<typeof plainCitationIndex>;

export function plainCitationIndex(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<CitationIndex, never>,
    "runSync" | "runPromiseExit" | "runFork" | "scope"
  >,
) {
  const service = runtime.runSync(CitationIndex);
  const context = runtime.runSync(Effect.context<never>());
  const run = Effect.runSyncWith(context);
  const runReleased = Effect.runPromiseWith(context);
  const closed = () => runtime.scope.state._tag === "Closed";
  async function invoke<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    let exit = closed()
      ? await runReleased(Effect.exit(effect))
      : await runtime.runPromiseExit(effect);
    // A call interrupted by unload reads the released service's terminal state.
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
      await runReleased(
        Stream.runHead(
          service.changes.pipe(Stream.filter((state) => state.stopped)),
        ),
      );
      exit = await runReleased(Effect.exit(effect));
    }
    if (Exit.isSuccess(exit)) return exit.value;
    const error = Cause.squash(exit.cause);
    throw Cause.isUnknownError(error) ? error.cause : error;
  }
  return {
    get coverage() {
      return run(service.current).coverage;
    },
    get current() {
      return run(service.current);
    },
    changes: service.changes,
    changed: service.events.pipe(
      Stream.filter((event) => event.type === "changed"),
      Stream.map((event) => event.path),
    ),
    backfilled: service.changes.pipe(
      Stream.map((state) => state.backfilled),
      Stream.changes,
      Stream.filter(Boolean),
      Stream.map(() => undefined),
    ),
    "membership-changed": service.events.pipe(
      Stream.filter((event) => event.type === "membership-changed"),
      Stream.map(() => undefined),
    ),
    "cited-by-invalidated": service.events.pipe(
      Stream.filter((event) => event.type === "cited-by-invalidated"),
      Stream.map(() => undefined),
    ),
    observeCitedBy: (...args: Parameters<typeof service.observeCitedBy>) =>
      closed() ? () => {} : runtime.runSync(service.observeCitedBy(...args)),
    syntaxes: (...args: Parameters<typeof service.syntaxes>) =>
      run(service.syntaxes(...args)),
    citationKeys: (...args: Parameters<typeof service.citationKeys>) =>
      run(service.citationKeys(...args)),
    annotationCitationKeys: (
      ...args: Parameters<typeof service.annotationCitationKeys>
    ) => run(service.annotationCitationKeys(...args)),
    getAnnotationUses: (
      ...args: Parameters<typeof service.getAnnotationUses>
    ) => run(service.getAnnotationUses(...args)),
    citationsByPath: (...args: Parameters<typeof service.citationsByPath>) =>
      run(service.citationsByPath(...args)),
    getFileScan: (...args: Parameters<typeof service.getFileScan>) =>
      invoke(service.getFileScan(...args)),
    getDocumentCitationSet: (
      ...args: Parameters<typeof service.getDocumentCitationSet>
    ) => invoke(service.getDocumentCitationSet(...args)),
    getParsedNote: (...args: Parameters<typeof service.getParsedNote>) =>
      invoke(service.getParsedNote(...args)),
    getParsedDocument: (
      ...args: Parameters<typeof service.getParsedDocument>
    ) => invoke(service.getParsedDocument(...args)),
    whenIndexed: (...args: Parameters<typeof service.whenIndexed>) =>
      invoke(service.whenIndexed(...args)),
    getCitedBy: (...args: Parameters<typeof service.getCitedBy>) =>
      invoke(service.getCitedBy(...args)),
    documentOmittedSyntaxes: (
      ...args: Parameters<typeof service.documentOmittedSyntaxes>
    ) => invoke(service.documentOmittedSyntaxes(...args)),
    citedByOmittedSyntaxes: (
      ...args: Parameters<typeof service.citedByOmittedSyntaxes>
    ) => invoke(service.citedByOmittedSyntaxes(...args)),
    reset: (...args: Parameters<typeof service.reset>) =>
      invoke(service.reset(...args)),
    waitUntilSettled: (...args: Parameters<typeof service.waitUntilSettled>) =>
      invoke(service.waitUntilSettled(...args)),
    readAnnotationUses: service.readAnnotationUses,
    readReferences: service.readReferences,
    readCitedBy: service.readCitedBy,
  };
}
