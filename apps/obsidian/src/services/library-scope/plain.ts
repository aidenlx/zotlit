/** Library Scope for views and legacy services, on the plugin runtime. */
import type { Library } from "@zotlit/db";

import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import type {
  AvailableLibrary,
  LibraryScope as SavedLibraryScope,
  ResolvedLibraryScope,
} from "./scope";
import { LibraryScope } from "./service";
import type { LibraryScopeEvents, LibraryScopeState } from "./service";

export interface PlainLibraryScope {
  /** Held resolution, with stable identity until it changes; null while unreadable. */
  readonly current: ResolvedLibraryScope | null;
  /** The saved selection, or My Library while the saved value is broken. */
  readonly effective: SavedLibraryScope;
  /** Independent of database availability, so recovery remains possible. */
  readonly invalid: boolean;
  /** All Libraries in canonical order, including those outside the saved scope. */
  readonly libraries: readonly AvailableLibrary[];
  /** The rows from the Held Read, or null when none is held. */
  readonly libraryRows: readonly Library[] | null;
  /** Resolve once against a caller's Snapshot Libraries. */
  resolveLibraries(libraries: readonly Library[]): ResolvedLibraryScope;
  /** Every state change after this call; the subscription attaches before returning. */
  subscribe(callback: (state: LibraryScopeState) => void): () => void;
  on<K extends keyof LibraryScopeEvents>(
    event: K,
    callback: LibraryScopeEvents[K],
  ): () => void;
}

export function plainLibraryScope(
  runtime: ManagedRuntime.ManagedRuntime<LibraryScope, never>,
): PlainLibraryScope {
  const service = runtime.runSync(LibraryScope);
  const run = Effect.runSyncWith(runtime.runSync(Effect.context<never>()));
  const subscribeChanges = (callback: (state: LibraryScopeState) => void) => {
    if (runtime.scope.state._tag === "Closed") return () => {};
    const seen = run(service.state);
    return subscribe(
      runtime,
      Stream.dropWhile(service.changes, (next) => next === seen),
      callback,
    );
  };
  return {
    get current() {
      return run(service.current);
    },
    get effective() {
      return run(service.effective);
    },
    get invalid() {
      return run(service.invalid);
    },
    get libraries() {
      return run(service.libraries);
    },
    get libraryRows() {
      return run(service.libraryRows);
    },
    resolveLibraries: (libraries) => run(service.resolveLibraries(libraries)),
    subscribe: subscribeChanges,
    on: (event, callback) => {
      let before = run(service.state);
      return subscribeChanges((next) => {
        const previous = before;
        before = next;
        if (
          event === "changed" &&
          (previous.current !== next.current ||
            previous.invalid !== next.invalid)
        )
          (callback as LibraryScopeEvents["changed"])(next.current);
        if (event === "libraries-changed" && previous.all !== next.all)
          (callback as LibraryScopeEvents["libraries-changed"])();
      });
    },
  };
}
