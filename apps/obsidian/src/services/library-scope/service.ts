/**
 * `LibraryScopeService` — the live Library Scope, resolved from the saved
 * stable selectors against whatever Libraries the active Zotero database holds.
 *
 * The policy is pure and lives in `./scope.ts`; this service owns only the
 * wiring: read the saved value (and its broken-override diagnostic) from
 * {@link SettingsService}, resolve it against the Libraries the
 * {@link ZoteroReadsService} last answered, and emit `changed` when the result
 * stops meaning the same thing to consumers.
 *
 * ## Held Libraries
 *
 * The Libraries are a Held Read (ADR 0054/0060): a database change starts a
 * fresh `Libraries` read, and {@link LibraryScopeService.current} keeps the
 * previous resolution until that read settles. A failed read keeps it too.
 *
 * ## Unavailable database versus zero Libraries
 *
 * {@link LibraryScopeService.current} is `null` while the database cannot be
 * read: before the first read settles, and after the database degrades. That is a different state from a valid scope whose Libraries are all
 * absent, which resolves normally with an empty `available` list. Settings
 * controls disable on the first and stay editable on the second, and the saved
 * value is untouched either way.
 *
 * ## Leases
 *
 * A caller holding a database read lease resolves once
 * against its own pinned client through {@link LibraryScopeService.resolveWith},
 * so a refresh mid-read cannot move the Libraries under it.
 */
import { Effect } from "effect";

import { getLibraries } from "@zotlit/db";
import type { Library } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import {
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
  resolveLibraryScope,
  sameResolution,
} from "./scope";
import type {
  AvailableLibrary,
  LibraryScope,
  ResolvedLibraryScope,
} from "./scope";

const logger = getLogger(["library-scope"]);

/** The settings key holding the saved scope. */
export const LIBRARY_SCOPE_KEY = "zotero.library-scope";

/** The query key the held Libraries live under. */
const LIBRARIES_KEY = ["library-scope", "libraries"] as const;

export interface LibraryScopeEvents {
  /**
   * The resolved scope changed, or became `null` because the database went
   * away. Equivalent refreshes — including a re-read that finds the same
   * Libraries under the same names — emit nothing.
   */
  changed: (scope: ResolvedLibraryScope | null) => void;
  /** All available Libraries changed, including Libraries outside the saved scope. */
  "libraries-changed": () => void;
}

export interface LibraryScopeDeps {
  reads: Pick<ZoteroReadsService, "ready" | "on">;
  queries: Pick<
    QueryClientService,
    "client" | "ask" | "invalidate" | "peek" | "watch"
  >;
  settings: SettingsService;
  /** Reads the Libraries for {@link LibraryScopeService.resolveWith}. */
  loadLibraries?: (client: NodeDatabaseClient) => Library[];
}

export class LibraryScopeService extends Service<void> {
  readonly #reads;
  readonly #queries;
  readonly #settings;
  readonly #loadLibraries;
  readonly #emitter = createNanoEvents<LibraryScopeEvents>();

  #current: ResolvedLibraryScope | null = null;
  #lastInvalid = false;
  #all: ResolvedLibraryScope | null = null;

  ready: Promise<void>;

  constructor(deps: LibraryScopeDeps) {
    super();
    this.#reads = deps.reads;
    this.#queries = deps.queries;
    this.#settings = deps.settings;
    this.#loadLibraries = deps.loadLibraries ?? getLibraries;
    this.ready = this.#load();
  }

  /**
   * The resolved scope, or `null` while the Zotero database is unreadable.
   * @returns the same object identity until something a consumer cares about
   * changes, so a subscriber can compare by reference.
   */
  get current(): ResolvedLibraryScope | null {
    return this.#current;
  }

  /**
   * The scope in force: the saved value, or {@link MY_LIBRARY_SCOPE} while the
   * saved value is broken. What the recovery UI edits, so an edit replaces the
   * broken value with what ZotLit is actually using.
   */
  get effective(): LibraryScope {
    return this.#savedScope() ?? MY_LIBRARY_SCOPE;
  }

  /**
   * Every Library the active database holds, in canonical order — the pool a
   * selection draws from, whatever the saved scope names. Empty while the
   * database is unreadable.
   */
  get libraries(): readonly AvailableLibrary[] {
    return this.#all?.available ?? [];
  }

  /**
   * The Library rows the last read of the database returned, whatever the
   * saved scope names; `null` while no read is held.
   */
  get libraryRows(): readonly Library[] | null {
    return this.#queries.peek<Library[]>(LIBRARIES_KEY)?.value ?? null;
  }

  /**
   * The saved value failed validation and the runtime fallback — Selected
   * My Library — is in force. Independent of database availability, so the
   * recovery UI reports it even while no Library can be listed.
   */
  get invalid(): boolean {
    return this.#settings.diagnostics.some(
      (diagnostic) => diagnostic.key === LIBRARY_SCOPE_KEY,
    );
  }

  /** Resolve the saved scope against a caller-pinned database client. */
  resolveWith(client: NodeDatabaseClient): ResolvedLibraryScope {
    return this.resolveLibraries(this.#loadLibraries(client));
  }

  /** Resolve the saved scope against Libraries the caller read from one Snapshot. */
  resolveLibraries(libraries: readonly Library[]): ResolvedLibraryScope {
    return resolveLibraryScope(libraries, this.#savedScope());
  }

  on<K extends keyof LibraryScopeEvents>(
    event: K,
    cb: LibraryScopeEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await this.#settings.loaded;

    await using stack = new AsyncDisposableStack();
    this.#queries.client.setQueryDefaults(LIBRARIES_KEY, { gcTime: Infinity });
    // An equal read keeps the held Libraries, so only a different answer
    // reaches the resolution.
    stack.defer(
      this.#queries.watch<Library[]>(LIBRARIES_KEY, {
        changed: () => this.#recompute(),
        settled: () => {},
      }),
    );
    stack.defer(
      this.#reads.on("changed", () => {
        this.#queries.invalidate(LIBRARIES_KEY);
        void this.#readLibraries();
      }),
    );
    stack.defer(
      this.#reads.on("degraded", () => {
        this.#queries.client.removeQueries({ queryKey: LIBRARIES_KEY });
        this.#recompute();
      }),
    );
    stack.defer(
      this.#settings.subscribe((next) => {
        if (next !== null) this.#recompute();
      }),
    );
    this.commit(stack.move());

    await this.#reads.ready;
    await this.#readLibraries();
    this.#recompute();
    logger.info("Library scope ready", {
      mode: this.#current?.mode ?? null,
      available: this.#current?.available.length ?? null,
      invalid: this.#lastInvalid,
    });
  }

  /** The validated saved scope, or `null` when the persisted value is broken. */
  #savedScope(): LibraryScope | null {
    if (this.invalid) return null;
    return this.#settings.current?.[LIBRARY_SCOPE_KEY] ?? DEFAULT_LIBRARY_SCOPE;
  }

  #recompute(): void {
    const all = this.#resolveNow(DEFAULT_LIBRARY_SCOPE);
    if (!sameResolution(all, this.#all)) {
      this.#all = all;
      this.#emitter.emit("libraries-changed");
    }
    const invalid = this.invalid;
    const next = this.#resolveNow(this.#savedScope());
    if (invalid === this.#lastInvalid && sameResolution(next, this.#current)) {
      logger.trace("Library scope refresh produced an equivalent resolution");
      return;
    }
    this.#lastInvalid = invalid;
    this.#current = next;
    logger.debug("Library scope changed", {
      mode: next?.mode ?? null,
      available: next?.available.map((library) => library.libraryID) ?? null,
      unavailable: next?.unavailable.length ?? null,
      invalid,
    });
    this.#emitter.emit("changed", next);
  }

  /** Read the Libraries into the held value; a failure keeps what it holds. */
  async #readLibraries(): Promise<void> {
    await this.#queries.ask<Library[]>(LIBRARIES_KEY, async ({ signal }) => {
      const { reads } = await this.#reads.ready;
      return Effect.runPromise(reads.Libraries({}), { signal });
    });
  }

  /** @returns `null` while no read of the Libraries is held. */
  #resolveNow(scope: LibraryScope | null): ResolvedLibraryScope | null {
    const libraries = this.#queries.peek<Library[]>(LIBRARIES_KEY)?.value;
    return libraries ? resolveLibraryScope(libraries, scope) : null;
  }
}
