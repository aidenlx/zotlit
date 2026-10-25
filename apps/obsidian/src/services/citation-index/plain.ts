/** Citation services for views and legacy services, on the plugin runtime. */
import { Cause, Effect, Exit, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import type { TFile } from "obsidian";

import { effectBridge } from "@/lib/effect-bridge";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import {
  CitationLookup,
  inertObservation,
  lookupChanged,
  lookupStatusChanged,
} from "./lookup-service";
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
  const bridge = effectBridge(runtime);
  const service = runtime.runSync(CitationLookup);
  const released = () =>
    new DOMException("Citation Lookup released", "AbortError");
  return {
    get status() {
      return bridge.runSync(service.current).status;
    },
    changes: service.changes,
    async read(request, { signal } = {}) {
      if (bridge.closed()) throw released();
      // Capture the caller's selection before crossing the async runtime boundary.
      const selected = {
        citekeys: [...(request.citekeys ?? [])],
        indexedKeys: [...(request.indexedKeys ?? [])],
        annotationKeys: [...(request.annotationKeys ?? [])],
      };
      const exit = await bridge.runPromiseExit(service.read(selected), {
        signal,
      });
      if (Exit.isSuccess(exit)) return exit.value;
      if (bridge.closed() || Cause.hasInterruptsOnly(exit.cause))
        throw released();
      throw Cause.squash(exit.cause);
    },
    observe: (changed) =>
      bridge.closed()
        ? inertObservation()
        : bridge.runSync(service.observe(changed)),
    async whenResolved() {
      if (!bridge.closed()) await bridge.runPromiseExit(service.whenResolved);
    },
    changed: lookupChanged(service),
    "status-changed": lookupStatusChanged(service),
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
  const bridge = effectBridge(runtime);
  const service = runtime.runSync(CitationIndex);
  /** Runs one call; the caller's signal interrupts it and rejects with its reason. */
  async function invoke<A, E>(
    effect: Effect.Effect<A, E>,
    signal?: AbortSignal,
  ): Promise<A> {
    let exit = bridge.closed()
      ? await bridge.runPromise(Effect.exit(effect))
      : await bridge.runPromiseExit(
          effect,
          signal === undefined ? undefined : { signal },
        );
    if (
      signal?.aborted &&
      Exit.isFailure(exit) &&
      Cause.hasInterruptsOnly(exit.cause)
    )
      throw signal.reason;
    // A call interrupted by unload reads the released service's terminal state.
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
      await bridge.runPromise(
        Stream.runHead(
          service.changes.pipe(Stream.filter((state) => state.stopped)),
        ),
      );
      exit = await bridge.runPromise(Effect.exit(effect));
    }
    if (Exit.isSuccess(exit)) return exit.value;
    const error = Cause.squash(exit.cause);
    throw Cause.isUnknownError(error) ? error.cause : error;
  }
  return {
    get coverage() {
      return bridge.runSync(service.current).coverage;
    },
    get current() {
      return bridge.runSync(service.current);
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
      bridge.closed()
        ? () => {}
        : runtime.runSync(service.observeCitedBy(...args)),
    syntaxes: (...args: Parameters<typeof service.syntaxes>) =>
      bridge.runSync(service.syntaxes(...args)),
    citationKeys: (...args: Parameters<typeof service.citationKeys>) =>
      bridge.runSync(service.citationKeys(...args)),
    annotationCitationKeys: (
      ...args: Parameters<typeof service.annotationCitationKeys>
    ) => bridge.runSync(service.annotationCitationKeys(...args)),
    getAnnotationUses: (
      ...args: Parameters<typeof service.getAnnotationUses>
    ) => bridge.runSync(service.getAnnotationUses(...args)),
    citationsByPath: (...args: Parameters<typeof service.citationsByPath>) =>
      bridge.runSync(service.citationsByPath(...args)),
    getFileScan: (...args: Parameters<typeof service.getFileScan>) =>
      invoke(service.getFileScan(...args)),
    getDocumentCitationSet: (
      file: TFile,
      {
        signal,
        ...options
      }: NonNullable<Parameters<typeof service.getDocumentCitationSet>[1]> & {
        signal?: AbortSignal;
      } = {},
    ) => invoke(service.getDocumentCitationSet(file, options), signal),
    getParsedNote: (file: TFile, signal?: AbortSignal) =>
      invoke(service.getParsedNote(file), signal),
    getParsedDocument: (file: TFile, signal?: AbortSignal) =>
      invoke(service.getParsedDocument(file), signal),
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
