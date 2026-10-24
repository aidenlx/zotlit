/** Library Scope for views and legacy services, on the plugin runtime. */
import type { Library } from "@zotlit/db";

import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

import type {
  AvailableLibrary,
  LibraryScope as SavedLibraryScope,
  ResolvedLibraryScope,
} from "./scope";
import { LibraryScope, scopeChanges } from "./service";
import type { LibraryScopeState } from "./service";

export interface PlainLibraryScope {
  readonly changes: Stream.Stream<LibraryScopeState>;
  readonly changed: Stream.Stream<ResolvedLibraryScope | null>;
  readonly "libraries-changed": Stream.Stream<void>;
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
}

export function plainLibraryScope(
  runtime: ManagedRuntime.ManagedRuntime<LibraryScope, never>,
): PlainLibraryScope {
  const service = runtime.runSync(LibraryScope);
  const run = Effect.runSyncWith(runtime.runSync(Effect.context<never>()));
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
    changes: service.changes,
    changed: scopeChanges(service.changes).pipe(
      Stream.map((state) => state.current),
    ),
    "libraries-changed": service.changes.pipe(
      Stream.map((state) => state.all),
      Stream.changes,
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
  };
}
