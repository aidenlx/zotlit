// The vault-wide Citation Index: literal-citekey occurrences per file, wikilinks derived at query time.

import { TFile } from "obsidian";
import type { App, LinkCache, TAbstractFile } from "obsidian";

import { getCitekeysByLibrary } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { HeldReads } from "@/lib/held-reads";
import type { Held } from "@/lib/held-reads";
import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { groupCitations } from "./query";
import type { Citation, ResolvedNote } from "./query";
import {
  documentWikilinks,
  occurrencesEqual,
  scanCitekeyOccurrences,
} from "./scan";
import type { CitationOccurrence, CitationSyntax } from "./scan";
import { CitekeySnapshot } from "./snapshot";
import type { CitekeyResolution, ReadCitekeys, SnapshotItem } from "./snapshot";
import { openCitekeyStore } from "./store";
import type { CitekeyRecord, CitekeyStore, FileScan } from "./store";

export {
  citationsEqual,
  type Citation,
  type ResolvedNote,
  type ResolveOccurrence,
} from "./query";
export {
  scanDocumentCitations,
  type CitationOccurrence,
  type CitationSyntax,
  type MalformedWikilinkCitation,
} from "./scan";
export type { CitekeyResolution, SnapshotItem } from "./snapshot";
export {
  readReferenceSources,
  toOpenableAttachments,
  type DatabaseReadability,
  type OpenableAttachment,
  type ReferenceSource,
  type ReferenceSourceJoin,
} from "./sources";
export { type CitekeyRecord, type CitekeyStore, type FileScan } from "./store";

/** The Citation Occurrences in one citing Markdown note. */
export interface CitedByGroup {
  readonly path: string;
  readonly occurrences: readonly CitationOccurrence[];
}

export type CitationCoverage = "indexing" | "complete" | "degraded";
export type CitationKeyResolution = Held<CitekeySnapshot>["status"] | null;

/** Whether a Citation Syntax's occurrences reach a citation-command answer. */
export type CitationSyntaxAdmission = "included" | "excluded";

/** The admission of each Citation Syntax, as a citation command reports it. */
export type CitationSyntaxes = Readonly<
  Record<CitationSyntax, CitationSyntaxAdmission>
>;

/** Outcome of {@link CitationIndex.waitUntilSettled}. */
export type CitationSettleOutcome = "settled" | "timeout";

/** The reverse observation for one Literature Note's Item. */
export interface CitedBySnapshot {
  groups: readonly CitedByGroup[];
  coverage: CitationCoverage;
  resolution: CitationKeyResolution;
}

export function citedBySnapshotsEqual(
  prev: CitedBySnapshot,
  next: CitedBySnapshot,
): boolean {
  if (
    prev.coverage !== next.coverage ||
    prev.resolution !== next.resolution ||
    prev.groups.length !== next.groups.length
  ) {
    return false;
  }
  return prev.groups.every((group, index) => {
    const other = next.groups[index]!;
    return (
      group.path === other.path &&
      occurrencesEqual(group.occurrences, other.occurrences)
    );
  });
}

/** One document's active Citation Occurrences and its distinct cited works. */
export interface DocumentCitationSet {
  /** Eligible occurrences in document order, including repeated works. */
  occurrences: CitationOccurrence[];
  /** The same occurrences grouped for reference-list consumers. */
  citations: Citation[];
  /** Invalid explicit citation intent, excluded from CSL membership. */
  errors: DocumentCitationError[];
}

/** One citation source error a document-aware surface can help correct. */
export interface DocumentCitationError {
  kind: "malformed-wikilink";
  occurrence: CitationOccurrence;
}

/** Structural equality for document citation errors and their exact ranges. */
export function documentCitationErrorsEqual(
  prev: readonly DocumentCitationError[],
  next: readonly DocumentCitationError[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((error, index) => {
    const other = next[index]!;
    return (
      error.kind === other.kind &&
      occurrencesEqual([error.occurrence], [other.occurrence])
    );
  });
}

const logger = getLogger("citation-index");

/** Files the backfill scans between two yields to the host. */
const BACKFILL_CHUNK = 20;
const SNAPSHOT_KEY = "citekeys";

interface CitationIndexEvents {
  /** One document's literal-citekey occurrences changed. */
  changed: (path: string) => void;
  /** The vault-wide backfill finished; the index covers every Markdown file. */
  backfilled: () => void;
  /**
   * The citation-key resolution snapshot was rebuilt and now answers differently.
   * Vault-wide, unlike `changed`: every surface that resolves a citekey redraws.
   */
  "resolution-changed": () => void;
  /** The source choices changed the Document Citation Set of every document. */
  "membership-changed": () => void;
  /** A reverse observation input or readiness state changed. */
  "cited-by-invalidated": () => void;
}

export interface CitationIndexOptions {
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on">;
  /** Which Libraries a Citation Key resolves against. */
  libraryScope: Pick<
    LibraryScopeService,
    "ready" | "current" | "libraries" | "on"
  >;
  /**
   * Where scans survive a restart; a store that fails to open costs a full
   * rescan and nothing else.
   *
   * @default openCitekeyStore
   */
  openStore?: (app: App) => Promise<CitekeyStore>;
  /**
   * The bulk read the snapshot rebuilds from.
   *
   * @default getCitekeysByLibrary
   */
  readCitekeys?: ReadCitekeys;
}

/**
 * Answers which Citations a document contains, for both syntaxes.
 *
 * Literal-citekey occurrences are scanned from file bodies and held per path;
 * wikilink occurrences derive from Obsidian's metadata cache at query time, and
 * resolution to Zotero Items is lazy — a cross-file change therefore never
 * dirties a file's record. The incremental path scans the body the metadata
 * cache hands to its `changed` event, so it reads no file of its own; only the
 * backfill and an on-demand query do.
 *
 * Scans persist per file, and a record describes its file for as long as the
 * file's mtime and size are the ones the scan ran against. A restart therefore
 * costs only the files that changed while the app was closed.
 */
export class CitationIndex extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #settings;
  readonly #db;
  readonly #libraryScope;
  readonly #openStore;
  readonly #readCitekeys;
  readonly #emitter = createNanoEvents<CitationIndexEvents>();
  /** Scans by path; a path it covers with matching mtime and size needs no read. */
  readonly #scans = new Map<string, FileScan>();
  readonly #snapshots = new HeldReads<CitekeySnapshot>({
    limit: 1,
    same: (prev, next) => prev.sameAs(next),
  });
  /** Callers parked on a one-shot readiness signal; disposal flushes them. */
  readonly #waiters = new Set<() => void>();
  #store?: CitekeyStore;
  /**
   * Which build of the index is current. A reset starts the next one, which is
   * what keeps a backfill still in flight from writing the build it belongs to
   * into a store that has moved on.
   */
  #build = 0;
  #includePandocCitations = true;
  #includeWikilinkCitations = false;
  #backfilled = false;
  #coverage: CitationCoverage = "indexing";
  #stopped = false;

  ready: Promise<void>;

  constructor(options: CitationIndexOptions) {
    super();
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#settings = options.settings;
    this.#db = options.db;
    this.#libraryScope = options.libraryScope;
    this.#openStore = options.openStore ?? openCitekeyStore;
    this.#readCitekeys = options.readCitekeys ?? getCitekeysByLibrary;
    this.ready = this.#load();
  }

  /**
   * The active document's shared citation membership and source order.
   *
   * A document the backfill has not reached is scanned on demand, so the
   * active document is answered without waiting for the vault-wide pass.
   */
  async getDocumentCitationSet(file: TFile): Promise<DocumentCitationSet> {
    await this.ready;
    void this.#rebuildSnapshot();
    const { citekeys, links } = this.#admitted(
      file,
      await this.#coverFile(file),
    );
    const wikilinks = documentWikilinks(links);
    const citations = groupCitations(
      [...citekeys, ...wikilinks.occurrences].sort(
        (a, b) => a.position.start.offset - b.position.start.offset,
      ),
      (occurrence) => this.#resolve(occurrence, file.path),
    );
    const occurrences = citations
      .flatMap((citation) => citation.occurrences)
      .sort((a, b) => a.position.start.offset - b.position.start.offset);
    const errors = wikilinks.malformed
      .filter(({ occurrence }) => this.#resolve(occurrence, file.path) !== null)
      .map(({ occurrence }) => ({
        kind: "malformed-wikilink" as const,
        occurrence,
      }));
    return { occurrences, citations, errors };
  }

  on<K extends keyof CitationIndexEvents>(
    event: K,
    cb: CitationIndexEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  once<K extends keyof CitationIndexEvents>(
    event: K,
    cb: CitationIndexEvents[K],
  ): () => void {
    return this.#emitter.once(event, cb);
  }

  /**
   * Resolves once the index covers every Markdown file. Stronger than
   * {@link ready}, which only marks listener registration: the backfill starts
   * at layout-ready and runs in chunks well past it. A vault-wide consumer
   * awaits this; an active-document consumer queries straight away.
   */
  async whenIndexed(): Promise<void> {
    await this.ready;
    await this.#waitFor("backfilled", this.#backfilled);
  }

  /**
   * Observe the citations in the vault that resolve to an Item, under the same
   * source choices as the Document Citation Set.
   * The first snapshot waits for listener registration; later snapshots follow
   * progressive scans, citation-key resolution changes, and source choices.
   */
  observeCitedBy(
    indexedKey: string,
    callback: (snapshot: CitedBySnapshot) => void,
    includeNote: (file: TFile) => boolean = () => true,
  ): () => void {
    using listeners = new DisposableStack();
    let disposed = false;
    let published = false;
    let queued = false;
    let previous: CitedBySnapshot | null = null;

    const publish = (): void => {
      if (disposed || this.#stopped || !published) return;
      const next = this.#citedBy(indexedKey, includeNote);
      if (previous && citedBySnapshotsEqual(previous, next)) return;
      previous = next;
      try {
        callback(next);
      } catch (error) {
        logger.warn("Cited-by observer failed", { error });
      }
    };
    const onChange = (): void => {
      if (disposed || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        publish();
      });
    };
    listeners.defer(this.on("changed", onChange));
    listeners.defer(this.on("resolution-changed", onChange));
    listeners.defer(this.on("cited-by-invalidated", onChange));
    listeners.defer(this.on("backfilled", onChange));
    listeners.defer(this.on("membership-changed", onChange));

    void this.ready.then(() => {
      if (disposed || this.#stopped) return;
      published = true;
      publish();
    });

    const ownedListeners = listeners.move();
    return () => {
      disposed = true;
      ownedListeners.dispose();
    };
  }

  /**
   * The reverse observation as one read, for a caller that answers a single
   * question instead of following the index — the agent-facing CLI. It reports
   * whatever the index holds now, so {@link waitUntilSettled} is what a caller
   * that wants a complete answer runs first.
   */
  getCitedBy(indexedKey: string): CitedBySnapshot {
    return this.#citedBy(indexedKey, () => true);
  }

  /**
   * Wait until coverage and citation-key resolution both have settled once. A
   * failed resolution read counts as settled data rather than a stage that
   * resolves on its own.
   *
   * @returns `"timeout"` when the bounded wait expires, `"settled"` otherwise.
   */
  async waitUntilSettled(timeoutMs: number): Promise<CitationSettleOutcome> {
    if (timeoutMs <= 0) return "timeout";
    return await new Promise<CitationSettleOutcome>((resolve) => {
      const timer = window.setTimeout(() => resolve("timeout"), timeoutMs);
      void Promise.all([this.whenIndexed(), this.whenResolved()]).then(() => {
        window.clearTimeout(timer);
        resolve("settled");
      });
    });
  }

  /**
   * How well citation keys currently resolve, for a caller that answers one
   * question and reports the state beside its facts — the agent-facing CLI. The
   * reverse observation carries the same state inside its snapshot.
   */
  get resolution(): CitationKeyResolution {
    const record = this.#heldSnapshot();
    return record?.status ?? null;
  }

  /**
   * Which Citation Syntaxes admit their occurrences into an answer, for a
   * caller that declares the constraint beside its facts — the agent-facing
   * CLI. Follows `citation.pandoc-citations` and `citation.wikilink-citations`,
   * the same source choices {@link #admitted} gates both membership surfaces on.
   */
  syntaxes(): CitationSyntaxes {
    return {
      citekey: this.#includePandocCitations ? "included" : "excluded",
      wikilink: this.#includeWikilinkCitations ? "included" : "excluded",
    };
  }

  /**
   * The excluded Citation Syntaxes that hold an occurrence in `file` — the
   * fact every `references` answer carries, so a short entry list still
   * names what a setting left out.
   *
   * An occurrence counts only if admitting its syntax would have put it in
   * the Document Citation Set: a citekey scan need only be non-empty, since
   * {@link groupCitations} keeps an unresolvable citekey as an `unresolved`
   * entry; a wikilink must resolve to an Item, and a malformed one counts
   * too when it resolves, because it would produce a `malformed` entry.
   *
   * @see referenceEntries in `cli/commands.ts`
   */
  async documentOmittedSyntaxes(file: TFile): Promise<CitationSyntax[]> {
    await this.ready;
    const omitted: CitationSyntax[] = [];
    if (!this.#includePandocCitations) {
      const scanned = await this.#coverFile(file);
      if (scanned.length > 0) omitted.push("citekey");
    }
    if (!this.#includeWikilinkCitations) {
      const links = this.#app.metadataCache.getFileCache(file)?.links ?? [];
      const { occurrences, malformed } = documentWikilinks(links);
      const held =
        occurrences.some(
          (occurrence) => this.#resolve(occurrence, file.path) !== null,
        ) ||
        malformed.some(
          ({ occurrence }) => this.#resolve(occurrence, file.path) !== null,
        );
      if (held) omitted.push("wikilink");
    }
    return omitted;
  }

  /**
   * What a native citation key names in the current Library Scope, read
   * synchronously: no Item, exactly one, or several candidates.
   */
  resolveCitekey(citekey: string): CitekeyResolution | null {
    const record = this.#heldSnapshot();
    return record?.value.resolve(citekey) ?? null;
  }

  /** The native citation key of an Item — the wikilink display text. */
  citekeyOf(indexedKey: string): string | null {
    const record = this.#heldSnapshot();
    return record?.value.citekeyOf(indexedKey) ?? null;
  }

  /**
   * Resolves once the snapshot has run its first rebuild — the resolution
   * counterpart of {@link whenIndexed}. Settles even on a failed read.
   */
  async whenResolved(): Promise<void> {
    await this.ready;
    if (this.#stopped) return;
    await this.#waitForRead(this.#rebuildSnapshot());
  }

  /** Settles a first snapshot read or disposal, whichever comes first. */
  #waitForRead(read: Promise<Held<CitekeySnapshot> | null>): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        this.#waiters.delete(wake);
        resolve();
      };
      this.#waiters.add(wake);
      void read.then(wake);
    });
  }

  /**
   * Waits for a one-shot readiness signal, which disposal settles too: the pass
   * that would emit the signal returns early once the service is stopped, so a
   * caller torn down alongside the service would otherwise wait on nothing.
   */
  #waitFor(
    event: "backfilled" | "resolution-changed",
    settled: boolean,
  ): Promise<void> {
    if (settled || this.#stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        off();
        this.#waiters.delete(wake);
        resolve();
      };
      const off = this.once(event, wake);
      this.#waiters.add(wake);
    });
  }

  /**
   * Discards every stored scan and rebuilds from the vault — the recovery hatch
   * for an index that disagrees with the vault, over data the vault can always
   * produce again. Returns once the store is empty; the rebuild runs on from
   * there, and {@link whenIndexed} is what waits for it.
   */
  async reset(): Promise<void> {
    await this.ready;
    this.#build += 1;
    const covered = [...this.#scans.keys()];
    logger.debug("Citation index reset", { covered: covered.length });
    this.#scans.clear();
    this.#backfilled = false;
    this.#coverage = "indexing";
    this.#emitter.emit("cited-by-invalidated");
    try {
      await this.#store?.clear();
    } catch (error) {
      logger.warn("Failed to clear citation scans", { error });
    }
    for (const path of covered) this.#emitter.emit("changed", path);
    void this.#runBackfill();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;
    const initial = this.#settings.current;
    if (initial) {
      this.#includePandocCitations = initial["citation.pandoc-citations"];
      this.#includeWikilinkCitations = initial["citation.wikilink-citations"];
    }
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );

    const { metadataCache, vault, workspace } = this.#app;
    stack.use(
      registerEvent(
        metadataCache.on("changed", (file, data) => {
          if (!isMarkdownFile(file)) return;
          this.#scan(file, data);
          this.#emitter.emit("cited-by-invalidated");
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("deleted", (file) => {
          this.#drop(file.path);
          this.#emitter.emit("cited-by-invalidated");
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("resolve", () => {
          this.#emitter.emit("cited-by-invalidated");
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("resolved", () => {
          this.#emitter.emit("cited-by-invalidated");
        }),
      ),
    );
    // A rename fires no re-parse of its own, so the record moves with the file.
    stack.use(
      registerEvent(
        vault.on("rename", (file, oldPath) => {
          this.#move(oldPath, file.path);
          this.#emitter.emit("cited-by-invalidated");
        }),
      ),
    );
    stack.defer(this.#db.on("changed", () => this.#invalidateSnapshot()));
    // Library Scope decides which Libraries a Citation Key resolves against,
    // so narrowing or widening it can turn an Ambiguous key unique and back.
    stack.defer(
      this.#libraryScope.on("changed", () => this.#invalidateSnapshot()),
    );
    stack.defer(
      this.#snapshots.on("changed", () =>
        this.#emitter.emit("resolution-changed"),
      ),
    );
    stack.defer(
      this.#snapshots.on("settled", (_key, snapshot) => {
        // A no-value settlement leaves the public resolution pending. Waking a
        // reverse observer would make its next ask repeat the failed read.
        if (snapshot === null) {
          logger.trace(
            "Resolution snapshot settlement kept reverse observers pending",
            { resolution: null },
          );
          return;
        }
        this.#emitter.emit("cited-by-invalidated");
      }),
    );
    stack.use(this.#snapshots);

    // A store that fails to open leaves the index whole and unpersisted, so the
    // failure costs a rescan per launch rather than the feature.
    try {
      this.#store = stack.use(await this.#openStore(this.#app));
      const loaded = await this.#store.load();
      let restored = 0;
      for (const { path, ...scan } of loaded) {
        // An event that already scanned the file during startup is fresher.
        if (!this.#scans.has(path)) {
          this.#scans.set(path, scan);
          restored += 1;
        }
      }
      logger.debug("Citation index store loaded", {
        count: loaded.length,
        restored,
      });
    } catch (error) {
      logger.error("Citation index store unavailable", { error });
    }

    // The vault holds no files before layout-ready, and `onLayoutReady` is a
    // one-shot with no unregister, so the run gates on disposal instead.
    workspace.onLayoutReady(() => void this.#runBackfill());

    void this.#rebuildSnapshot();
    // Registered last so it runs first on disposal (stack is LIFO): the flag
    // must flip before the store and listeners tear down, so a persist or a
    // db-driven rebuild still in flight during the async disposal window
    // no-ops instead of writing to a closed store or emitting mid-disposal.
    stack.defer(() => {
      this.#stopped = true;
      for (const wake of this.#waiters) wake();
    });
    this.commit(stack.move());
  }

  /** Readiness settles even on a failed pass, so no consumer waits forever. */
  async #runBackfill(): Promise<void> {
    const build = this.#build;
    logger.debug("Citation index backfill started", { build });
    let failed = false;
    try {
      failed = await this.#backfill(build);
    } catch (error) {
      logger.error("Citation index backfill failed", { error });
      failed = true;
    }
    if (this.#stopped || build !== this.#build) return;
    logger.debug("Citation index backfilled", { count: this.#scans.size });
    this.#backfilled = true;
    this.#coverage = failed ? "degraded" : "complete";
    this.#emitter.emit("backfilled");
  }

  /**
   * The vault pass that covers the files neither an event nor the store reached.
   * It streams one body at a time rather than holding the vault in memory, and
   * yields to the host between chunks so a large vault never freezes the app.
   *
   * @returns Whether at least one note could not be read.
   */
  async #backfill(build: number): Promise<boolean> {
    let scanned = 0;
    let failed = false;
    const present = new Set<string>();
    for (const file of this.#app.vault.getMarkdownFiles()) {
      if (this.#stale(build)) return failed;
      present.add(file.path);
      if (this.#covered(file)) continue;
      while (!this.#covered(file)) {
        const { mtime, size } = file.stat;
        let body: string;
        try {
          body = await this.#app.vault.cachedRead(file);
        } catch (error) {
          failed = true;
          logger.warn("Citation backfill could not read note", {
            path: file.path,
            error,
          });
          break;
        }
        // The read yields, so a new build or a fresher metadata event may have
        // taken over. A file edited without an event is read again at its new
        // state rather than pairing the old body with the new file stats.
        if (this.#stale(build)) return failed;
        if (this.#covered(file)) break;
        if (file.stat.mtime !== mtime || file.stat.size !== size) continue;
        this.#scan(file, body);
      }
      if ((scanned += 1) % BACKFILL_CHUNK === 0) await yieldToMain();
    }
    // A file deleted while the app was closed fires no event of its own, so the
    // pass is also what prunes the scans the vault no longer has a file for.
    for (const path of this.#scans.keys().toArray()) {
      if (!present.has(path)) this.#drop(path);
    }
    return failed;
  }

  /** Whether a build other than `build` has taken over. */
  #stale(build: number): boolean {
    return this.#stopped || build !== this.#build;
  }

  /**
   * Rebuilds the resolution snapshot from one bulk read per local Library.
   * The Held Read commits only the current read. A degraded database, or a read
   * that throws, leaves the maps as they were rather than clearing them.
   *
   * Every local Library is read, because the reverse lookup by exact Indexed
   * Key covers them all; Library Scope then decides which of those rows the
   * forward Citation Key lookup answers from.
   */
  #invalidateSnapshot(): void {
    this.#snapshots.invalidate();
    void this.#rebuildSnapshot();
  }

  #heldSnapshot(): Held<CitekeySnapshot> | null {
    const snapshot = this.#snapshots.peek(SNAPSHOT_KEY);
    void this.#rebuildSnapshot();
    return snapshot;
  }

  #rebuildSnapshot(): Promise<Held<CitekeySnapshot> | null> {
    if (this.#stopped) {
      return Promise.resolve(this.#snapshots.peek(SNAPSHOT_KEY));
    }
    return this.#snapshots.read(SNAPSHOT_KEY, () => this.#readSnapshot());
  }

  async #readSnapshot(): Promise<CitekeySnapshot | null> {
    try {
      await this.#db.ready;
      await this.#libraryScope.ready;
    } catch (error) {
      logger.warn("Resolution snapshot database unavailable", { error });
      return null;
    }
    if (this.#stopped) return null;

    const scope = this.#libraryScope.current;
    if (this.#db.state !== "ready" || scope === null) {
      logger.debug("Resolution snapshot rebuild skipped, database not ready");
      return null;
    }
    try {
      const inScope = new Set(
        scope.available.map((library) => library.libraryID),
      );
      const rows = this.#libraryScope.libraries.flatMap((library) =>
        this.#readCitekeys(this.#db.client, library.libraryID),
      );
      logger.debug("Resolution snapshot rebuilt", {
        libraries: this.#libraryScope.libraries.length,
        inScope: inScope.size,
        count: rows.length,
      });
      return CitekeySnapshot.from(rows, inScope);
    } catch (error) {
      logger.warn("Resolution snapshot rebuild failed", { error });
      return null;
    }
  }

  /** Idempotent: a content-identical touch stores the same list and wakes nobody. */
  #scan(file: TFile, body: string): CitationOccurrence[] {
    const occurrences = scanCitekeyOccurrences(body);
    const prev = this.#scans.get(file.path);
    const { mtime, size } = file.stat;
    this.#scans.set(file.path, { mtime, size, occurrences });
    this.#persist({ path: file.path, mtime, size, occurrences });
    const quiet = prev
      ? occurrencesEqual(prev.occurrences, occurrences)
      : occurrences.length === 0;
    if (!quiet) {
      logger.trace("Citation scan changed", {
        path: file.path,
        count: occurrences.length,
      });
      this.#emitter.emit("changed", file.path);
    }
    return occurrences;
  }

  /**
   * @returns the scan that still describes `file`, or `null` when the file's
   *   mtime or size has moved past the one it ran against.
   */
  #covered(file: TFile): CitationOccurrence[] | null {
    const scan = this.#scans.get(file.path);
    if (!scan) return null;
    const { mtime, size } = file.stat;
    return scan.mtime === mtime && scan.size === size ? scan.occurrences : null;
  }

  async #coverFile(file: TFile): Promise<CitationOccurrence[]> {
    const known = this.#covered(file);
    if (known) return known;
    const body = await this.#app.vault.cachedRead(file);
    // The read yields, so an event may have covered the file meanwhile.
    return this.#covered(file) ?? this.#scan(file, body);
  }

  #drop(path: string): void {
    const scan = this.#scans.get(path);
    if (!scan) return;
    this.#scans.delete(path);
    this.#forget(path);
    if (scan.occurrences.length > 0) this.#emitter.emit("changed", path);
  }

  #move(oldPath: string, path: string): void {
    const scan = this.#scans.get(oldPath);
    if (!scan) return;
    this.#scans.delete(oldPath);
    this.#scans.set(path, scan);
    this.#forget(oldPath);
    this.#persist({ path, ...scan });
    if (scan.occurrences.length > 0) this.#emitter.emit("changed", path);
  }

  /**
   * Writes are per file and never awaited: the store is derived data, so a
   * failed write costs one rescan on the next launch. Every caller runs on the
   * current build, which is what keeps a superseded one out of the store.
   */
  #persist(record: CitekeyRecord): void {
    if (this.#stopped) return;
    void this.#store?.put(record).catch((error: unknown) => {
      logger.error("Failed to persist a citation scan", {
        path: record.path,
        error,
      });
    });
  }

  #forget(path: string): void {
    if (this.#stopped) return;
    void this.#store?.drop(path).catch((error: unknown) => {
      logger.error("Failed to drop a citation scan", { path, error });
    });
  }

  /**
   * The scanned occurrences and cache links the source choices admit, the one
   * gate both membership surfaces pass through: the active document's
   * {@link getDocumentCitationSet} and the vault-wide reverse observation.
   *
   * @param scanned the file's literal-citekey scan, already acquired: the
   * document surface awaits a scan on demand, the reverse one takes what the
   * backfill has covered so far.
   */
  #admitted(
    file: TFile,
    scanned: readonly CitationOccurrence[],
  ): { citekeys: readonly CitationOccurrence[]; links: readonly LinkCache[] } {
    return {
      citekeys: this.#includePandocCitations ? scanned : [],
      links: this.#includeWikilinkCitations
        ? (this.#app.metadataCache.getFileCache(file)?.links ?? [])
        : [],
    };
  }

  #citedBy(
    indexedKey: string,
    includeNote: (file: TFile) => boolean,
  ): CitedBySnapshot {
    const groups: CitedByGroup[] = [];
    const files = this.#app.vault
      .getMarkdownFiles()
      .filter(includeNote)
      .sort((a, b) => comparePaths(a.path, b.path));
    for (const file of files) {
      const { citekeys, links } = this.#admitted(
        file,
        this.#covered(file) ?? [],
      );
      const literals = citekeys.filter((occurrence) =>
        this.#citekeyOccurrenceCites(occurrence, indexedKey),
      );
      const wikilinks = documentWikilinks(links).occurrences.filter(
        (occurrence) =>
          this.#wikilinkOccurrenceCites(occurrence, file.path, indexedKey),
      );
      const occurrences = [...literals, ...wikilinks].sort(compareOccurrences);
      if (occurrences.length > 0) {
        groups.push({ path: file.path, occurrences });
      }
    }
    return {
      groups,
      coverage: this.#coverage,
      resolution: this.resolution,
    };
  }

  /**
   * The excluded Citation Syntaxes that hold an occurrence of `indexedKey`,
   * for a caller that answers one question and reports the fact beside it —
   * the agent-facing CLI. `observeCitedBy`'s snapshot carries no such field:
   * every publish would otherwise pay this walk, for a fact only the CLI
   * reads.
   *
   * Wikilink occurrences count only when eligible: `getCitedBy` puts only
   * eligible occurrences in groups, so a malformed one — unlike
   * {@link documentOmittedSyntaxes}'s references answer — never would have
   * joined this answer either.
   */
  async citedByOmittedSyntaxes(indexedKey: string): Promise<CitationSyntax[]> {
    await this.ready;
    const files = this.#app.vault.getMarkdownFiles();
    const omitted: CitationSyntax[] = [];
    if (!this.#includePandocCitations) {
      const held = files.some((file) =>
        (this.#covered(file) ?? []).some((occurrence) =>
          this.#citekeyOccurrenceCites(occurrence, indexedKey),
        ),
      );
      if (held) omitted.push("citekey");
    }
    if (!this.#includeWikilinkCitations) {
      const held = files.some((file) => {
        const links = this.#app.metadataCache.getFileCache(file)?.links ?? [];
        return documentWikilinks(links).occurrences.some((occurrence) =>
          this.#wikilinkOccurrenceCites(occurrence, file.path, indexedKey),
        );
      });
      if (held) omitted.push("wikilink");
    }
    return omitted;
  }

  /**
   * Whether a literal-citekey Citation Occurrence cites `indexedKey`.
   *
   * An Ambiguous Citation Key names every one of its candidates here, so one
   * occurrence answers for each of them: the reverse observation reports a
   * possible citation relationship rather than omitting it. The forward
   * direction stays untouched — the occurrence is still one Citation of the
   * key itself, so no candidate gains a Citation record of its own.
   */
  #citekeyOccurrenceCites(
    occurrence: CitationOccurrence,
    indexedKey: string,
  ): boolean {
    const resolved = this.resolveCitekey(occurrence.raw);
    if (resolved === null) return false;
    switch (resolved.kind) {
      case "missing":
        return false;
      case "unique":
        return resolved.item.indexedKey === indexedKey;
      case "ambiguous":
        return resolved.candidates.some(
          (candidate) => candidate.indexedKey === indexedKey,
        );
    }
  }

  /**
   * The one Item a citekey names, or `null` when it names none — and equally
   * when it names several, which adopts no candidate's Indexed Key.
   */
  #uniqueItem(citekey: string): SnapshotItem | null {
    const resolved = this.resolveCitekey(citekey);
    return resolved?.kind === "unique" ? resolved.item : null;
  }

  /** Whether a wikilink Citation Occurrence resolves to `indexedKey`. */
  #wikilinkOccurrenceCites(
    occurrence: CitationOccurrence,
    sourcePath: string,
    indexedKey: string,
  ): boolean {
    return (
      resolveIndexedKey(occurrence.raw, sourcePath, this.#app) === indexedKey
    );
  }

  #resolve(
    occurrence: CitationOccurrence,
    sourcePath: string,
  ): ResolvedNote | null {
    if (occurrence.kind === "wikilink") {
      const indexedKey = resolveIndexedKey(
        occurrence.raw,
        sourcePath,
        this.#app,
      );
      return indexedKey ? { indexedKey, linkpath: occurrence.raw } : null;
    }
    // An Ambiguous Citation Key keeps its own identity here: it adopts no
    // candidate's Indexed Key, so it stays a Citation of the key itself and
    // contributes no CSL work.
    const item = this.#uniqueItem(occurrence.raw);
    if (!item) return null;
    const [note] = this.#noteIndex.getNotesByItemKey(item.indexedKey);
    return { indexedKey: item.indexedKey, linkpath: note?.path ?? null };
  }

  /** Apply citation settings without stopping the internal scan or resolution. */
  #applySettings(settings: Readonly<Settings>): void {
    const nextPandoc = settings["citation.pandoc-citations"];
    const nextWikilinks = settings["citation.wikilink-citations"];
    const membershipChanged =
      nextPandoc !== this.#includePandocCitations ||
      nextWikilinks !== this.#includeWikilinkCitations;
    if (!membershipChanged) return;
    this.#includePandocCitations = nextPandoc;
    this.#includeWikilinkCitations = nextWikilinks;
    logger.debug("Citation source membership changed", {
      pandocCitations: nextPandoc,
      wikilinkCitations: nextWikilinks,
    });
    this.#emitter.emit("membership-changed");
  }
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOccurrences(
  a: CitationOccurrence,
  b: CitationOccurrence,
): number {
  return (
    a.position.start.offset - b.position.start.offset ||
    a.position.end.offset - b.position.end.offset ||
    comparePaths(a.raw, b.raw)
  );
}
