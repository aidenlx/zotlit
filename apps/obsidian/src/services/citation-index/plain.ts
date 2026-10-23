/** Citation services for views and legacy services, on the plugin runtime. */
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
import { CitationIndex } from "./service";
import type { CitationIndexState } from "./service";

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

/** Citation Index for views and legacy services, on the plugin runtime. */

interface IndexCallbacks {
  changed: (path: string) => void;
  backfilled: () => void;
  "membership-changed": () => void;
  "cited-by-invalidated": () => void;
}

export type PlainCitationIndex = ReturnType<typeof plainCitationIndex>;

export function plainCitationIndex(
  runtime: ManagedRuntime.ManagedRuntime<CitationIndex, never>,
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
  function listen<K extends keyof IndexCallbacks>(
    event: K,
    callback: IndexCallbacks[K],
  ): () => void {
    if (event === "backfilled")
      return subscribe(
        runtime,
        service.changes.pipe(
          Stream.map((state) => state.backfilled),
          Stream.changes,
          Stream.filter(Boolean),
        ),
        () => (callback as () => void)(),
      );
    return subscribe(runtime, service.events, (value) => {
      if (value.type !== event) return;
      if (value.type === "changed")
        (callback as IndexCallbacks["changed"])(value.path);
      else (callback as () => void)();
    });
  }
  function subscribeIndex(
    callback: (state: CitationIndexState) => void,
  ): () => void;
  function subscribeIndex<K extends keyof IndexCallbacks>(
    event: K,
    callback: IndexCallbacks[K],
  ): () => void;
  function subscribeIndex<K extends keyof IndexCallbacks>(
    event: K | ((state: CitationIndexState) => void),
    callback?: IndexCallbacks[K],
  ): () => void {
    return typeof event === "function"
      ? subscribe(runtime, service.changes, event)
      : listen(event, callback!);
  }
  return {
    get coverage() {
      return run(service.current).coverage;
    },
    get current() {
      return run(service.current);
    },
    subscribe: subscribeIndex,
    on: <K extends keyof IndexCallbacks>(
      event: K,
      callback: IndexCallbacks[K],
    ) => subscribeIndex(event, callback),
    once<K extends keyof IndexCallbacks>(
      event: K,
      callback: IndexCallbacks[K],
    ) {
      let seen = false;
      let off = () => {};
      off = listen(event, ((...args: unknown[]) => {
        if (seen) return;
        seen = true;
        off();
        (callback as (...args: unknown[]) => void)(...args);
      }) as IndexCallbacks[K]);
      if (seen) off();
      return off;
    },
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
