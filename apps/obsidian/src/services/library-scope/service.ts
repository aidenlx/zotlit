/** The live Library Scope, resolved against the Libraries held by QueryClients. */
import type { Library } from "@zotlit/db";

import {
  Cause,
  Context,
  Effect,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { startupBarrier } from "@/lib/effect-startup";
import { QueryClients } from "@/services/query-client/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import {
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
  resolveLibraryScope,
  sameResolution,
} from "./scope";
import type {
  AvailableLibrary,
  LibraryScope as SavedLibraryScope,
  ResolvedLibraryScope,
} from "./scope";

export const LIBRARY_SCOPE_KEY = "zotero.library-scope";
const LIBRARIES_KEY = ["library-scope", "libraries"] as const;

export interface LibraryScopeEvents {
  changed: (scope: ResolvedLibraryScope | null) => void;
  "libraries-changed": () => void;
}

/** A replayable snapshot, including an invalid saved value while the database is absent. */
export interface LibraryScopeState {
  readonly current: ResolvedLibraryScope | null;
  readonly all: ResolvedLibraryScope | null;
  readonly invalid: boolean;
  readonly effective: SavedLibraryScope;
  readonly libraryRows: readonly Library[] | null;
}

export class LibraryScope extends Context.Service<
  LibraryScope,
  {
    readonly state: Effect.Effect<LibraryScopeState>;
    readonly changes: Stream.Stream<LibraryScopeState>;
    readonly current: Effect.Effect<ResolvedLibraryScope | null>;
    readonly effective: Effect.Effect<SavedLibraryScope>;
    readonly invalid: Effect.Effect<boolean>;
    readonly libraries: Effect.Effect<readonly AvailableLibrary[]>;
    readonly libraryRows: Effect.Effect<readonly Library[] | null>;
    resolveLibraries(
      libraries: readonly Library[],
    ): Effect.Effect<ResolvedLibraryScope>;
  }
>()("zotlit/library-scope/LibraryScope") {}

/**
 * The states whose resolution or validity differs from the one before,
 * after the replayed state a subscriber starts from.
 */
export function scopeChanges(
  changes: Stream.Stream<LibraryScopeState>,
): Stream.Stream<LibraryScopeState> {
  return changes.pipe(
    Stream.changesWith(
      (a, b) => a.current === b.current && a.invalid === b.invalid,
    ),
    Stream.drop(1),
  );
}

export const layerLibraryScope = Layer.effect(
  LibraryScope,
  Effect.gen(function* () {
    const reads = yield* ZoteroReads;
    const queries = yield* QueryClients;
    const settings = yield* PluginSettings;
    const scope = yield* Scope.Scope;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    let closed = false;
    const state = yield* SubscriptionRef.make<LibraryScopeState>({
      current: null,
      all: null,
      invalid: false,
      effective: DEFAULT_LIBRARY_SCOPE,
      libraryRows: null,
    });
    const invalid = Effect.map(settings.diagnostics, (diagnostics) =>
      diagnostics.some((diagnostic) => diagnostic.key === LIBRARY_SCOPE_KEY),
    );
    const savedScope = Effect.fn("LibraryScope.savedScope")(function* (
      saved?: Readonly<Settings>,
    ) {
      return (yield* invalid)
        ? null
        : ((saved ?? (yield* settings.current))[LIBRARY_SCOPE_KEY] ??
            DEFAULT_LIBRARY_SCOPE);
    });

    const recompute = Effect.fn("LibraryScope.recompute")(function* (
      rows: readonly Library[] | null,
      saved?: Readonly<Settings>,
    ) {
      if (closed) return;
      const before = yield* SubscriptionRef.get(state);
      const selected = yield* savedScope(saved);
      const next = rows === null ? null : resolveLibraryScope(rows, selected);
      const all =
        rows === null ? null : resolveLibraryScope(rows, DEFAULT_LIBRARY_SCOPE);
      const broken = selected === null;
      const sameCurrent =
        broken === before.invalid && sameResolution(next, before.current);
      const sameAll = sameResolution(all, before.all);
      if (
        sameCurrent &&
        sameAll &&
        rows === before.libraryRows &&
        (selected ?? MY_LIBRARY_SCOPE) === before.effective
      )
        return;
      yield* SubscriptionRef.set(state, {
        current: sameCurrent ? before.current : next,
        all: sameAll ? before.all : all,
        invalid: broken,
        effective: selected ?? MY_LIBRARY_SCOPE,
        libraryRows: rows,
      });
      if (!sameCurrent)
        yield* Effect.logDebug("Library scope changed").pipe(
          Effect.annotateLogs({
            mode: next?.mode ?? null,
            available:
              next?.available.map((library) => library.libraryID) ?? null,
            unavailable: next?.unavailable.length ?? null,
            invalid: broken,
          }),
        );
    });
    const recover = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Could not refresh Library scope", cause),
        ),
      );
    const readLibraries = Effect.fn("LibraryScope.readLibraries")(function* () {
      if (closed) return;
      yield* queries.ask<Library[]>(LIBRARIES_KEY, ({ signal }) =>
        runPromise(reads.reads.Libraries({}), { signal }),
      );
      yield* recompute(
        (yield* queries.peek<Library[]>(LIBRARIES_KEY))?.value ?? null,
      );
    }, recover);
    const heldLibraries = Effect.fn("LibraryScope.heldLibraries")(function* () {
      if (closed) return null;
      const held = yield* queries.peek<Library[]>(LIBRARIES_KEY);
      if (held?.status === "failed")
        yield* Effect.forkIn(readLibraries(), scope);
      return held?.value ?? null;
    });

    queries.client.setQueryDefaults(LIBRARIES_KEY, { gcTime: Infinity });
    yield* Stream.runForEach(queries.changes, (change) => {
      if (
        change.key[0] !== LIBRARIES_KEY[0] ||
        change.key[1] !== LIBRARIES_KEY[1] ||
        !change.changed
      )
        return Effect.void;
      return recover(
        Effect.gen(function* () {
          const held = yield* queries.peek<Library[]>(LIBRARIES_KEY);
          // A queued settlement cannot restore rows that degradation removed.
          if (held?.value === change.held?.value)
            yield* recompute(held?.value ?? null);
        }),
      );
    }).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Stream.runForEach(reads.events, (event) =>
      recover(
        Effect.gen(function* () {
          if (event._tag === "changed") {
            yield* queries.invalidate(LIBRARIES_KEY);
            yield* Effect.forkIn(readLibraries(), scope, {
              startImmediately: true,
            });
          } else if (event._tag === "degraded") {
            queries.client.removeQueries({ queryKey: LIBRARIES_KEY });
            yield* recompute(null);
          }
        }),
      ),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Stream.runForEach(settings.changes, (saved) =>
      recover(
        Effect.gen(function* () {
          yield* recompute(yield* heldLibraries(), saved);
        }),
      ),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        queries.client.removeQueries({ queryKey: LIBRARIES_KEY });
        yield* PubSub.shutdown(state.pubsub);
      }),
    );

    // Legacy ready awaited this query, not a database-ready signal. A late
    // answer still updates the held value after the shared startup bound.
    yield* startupBarrier(
      readLibraries(),
      Effect.logWarning("Library scope startup read is still pending"),
    );
    yield* recompute(yield* heldLibraries());
    yield* Effect.logInfo("Library scope ready").pipe(
      Effect.annotateLogs({
        mode: (yield* SubscriptionRef.get(state)).current?.mode ?? null,
      }),
    );
    return LibraryScope.of({
      state: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      current: Effect.andThen(
        heldLibraries(),
        Effect.map(SubscriptionRef.get(state), (snapshot) => snapshot.current),
      ),
      effective: Effect.map(savedScope(), (saved) => saved ?? MY_LIBRARY_SCOPE),
      invalid,
      libraries: Effect.andThen(
        heldLibraries(),
        Effect.map(
          SubscriptionRef.get(state),
          (snapshot) => snapshot.all?.available ?? [],
        ),
      ),
      libraryRows: heldLibraries(),
      resolveLibraries: Effect.fn("LibraryScope.resolveLibraries")(function* (
        libraries: readonly Library[],
      ) {
        return resolveLibraryScope(libraries, yield* savedScope());
      }),
    });
  }).pipe(withLogCategory("library-scope")),
);
