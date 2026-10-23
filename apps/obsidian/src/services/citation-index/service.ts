// The renderer owns persisted note scans and citation membership; the parse client owns Markdown.

import { abortable } from "@std/async/abortable";
import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { Effect } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import { heldResolution } from "./lookup";
import type { CitationLookup, CitationLookupStatus } from "./lookup-service";
export type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
export type { CitationLookupObservation } from "./lookup-service";

import type { ParseClient } from "@/services/citation-parse/client";

import { groupCitations } from "./query";
import type { Citation, ResolvedNote } from "./query";
import { occurrencesEqual } from "./scan";
import type { CitationOccurrence, CitationSyntax } from "./scan";
import type { AnnotationOccurrence } from "./scan-note";
import type { CitekeyResolution } from "./snapshot";
import { openCitekeyStore, SCANNER_REVISION } from "./store";
import type { CitekeyRecord, CitekeyStore, FileScan } from "./store";

export {
  citationsEqual,
  type Citation,
  type ResolvedNote,
  type ResolveOccurrence,
} from "./query";
export {
  type CitationOccurrence,
  type CitationSyntax,
  type MalformedWikilinkCitation,
} from "./scan";
export type { CitekeyResolution, SnapshotItem } from "./snapshot";
export {
  readReferenceSources,
  toZoteroOpenableAttachments,
  type DatabaseReadability,
  type ZoteroOpenableAttachment,
  type ReferenceSource,
  type ReferenceSourceJoin,
} from "./sources";
export { type CitekeyRecord, type CitekeyStore, type FileScan } from "./store";
export type { AnnotationOccurrence } from "./scan-note";

export interface AnnotationUse {
  readonly path: string;
  readonly occurrence: AnnotationOccurrence;
}

/** The Citation Occurrences in one citing Markdown note. */
export interface CitedByGroup {
  readonly path: string;
  readonly occurrences: readonly CitationOccurrence[];
}

export type CitationCoverage = "indexing" | "complete" | "degraded";
export type CitationKeyResolution = Exclude<
  CitationLookupStatus,
  "pending"
> | null;

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
  /** Both lookup directions used to compose this document, at one revision. */
  lookup: CitationLookupAnswer;
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

/** Bounds retained note bodies and worker requests during the vault walk. */
const BACKFILL_CONCURRENCY = 4;
interface CitationIndexEvents {
  /** One document's stored parse facts changed. */
  changed: (path: string) => void;
  /** The vault-wide backfill finished; the index covers every Markdown file. */
  backfilled: () => void;
  /** The source choices changed the Document Citation Set of every document. */
  "membership-changed": () => void;
  /** A reverse observation input or readiness state changed. */
  "cited-by-invalidated": () => void;
}

export interface CitationIndexOptions {
  parseClient: ParseClient;
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
  lookup: Pick<
    CitationLookup,
    "read" | "observe" | "status" | "on" | "whenResolved"
  >;
  /**
   * Where scans survive a restart; a store that fails to open costs a full
   * rescan and nothing else.
   *
   * @default openCitekeyStore
   */
  openStore?: (app: App) => Promise<CitekeyStore>;
}

/** Stores raw parse results; resolves citations against current vault and Zotero facts. */
export class CitationIndex extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #settings;
  readonly #lookup;
  readonly #openStore;
  readonly #parseClient;
  readonly #emitter = createNanoEvents<CitationIndexEvents>();
  /** Scans by path; a path it covers with matching mtime and size needs no read. */
  readonly #scans = new Map<string, FileScan>();
  readonly #filesByCitekey = new Map<string, Set<string>>();
  readonly #annotationsByKey = new Map<
    string,
    Map<string, AnnotationOccurrence[]>
  >();
  readonly #failed = new Set<string>();
  readonly #generations = new Map<string, number>();
  #restoreInvalidated: Set<string> | null = new Set();
  readonly #pending = new Map<
    string,
    {
      path: string;
      generation: number;
      stop: AbortController;
      promise: Promise<FileScan | null>;
    }
  >();
  #generation = 0;
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
  #backfillBuild = -1;
  #backfillFailed = false;
  #stopped = false;
  readonly #stop = new AbortController();

  ready: Promise<void>;

  constructor(options: CitationIndexOptions) {
    super();
    this.#parseClient = options.parseClient;
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#settings = options.settings;
    this.#lookup = options.lookup;
    this.#openStore = options.openStore ?? openCitekeyStore;
    this.ready = this.#load();
  }

  /**
   * The active document's shared citation membership and source order.
   *
   * A document the backfill has not reached is scanned on demand, so the
   * active document is answered without waiting for the vault-wide pass.
   */
  async getDocumentCitationSet(
    file: TFile,
    {
      signal,
      include,
    }: { signal?: AbortSignal; include?: CitationLookupRequest } = {},
  ): Promise<DocumentCitationSet> {
    const lifetime = signal
      ? AbortSignal.any([signal, this.#stop.signal])
      : this.#stop.signal;
    lifetime.throwIfAborted();
    await abortable(this.ready, lifetime);
    const { citekeys, wikilinks } = this.#admitted(
      await abortable(this.#coverFile(file), lifetime),
    );
    const local = new Map(
      [
        ...wikilinks.occurrences,
        ...wikilinks.malformed.map(({ occurrence }) => occurrence),
      ].map(
        (occurrence) =>
          [occurrence, this.#resolve(occurrence, file.path)] as const,
      ),
    );
    const lookup = await this.#lookup.read(
      {
        citekeys: [
          ...citekeys.map((occurrence) => occurrence.raw),
          ...(include?.citekeys ?? []),
        ],
        indexedKeys: [
          ...wikilinks.occurrences.flatMap((occurrence) => {
            const key = local.get(occurrence)?.indexedKey;
            return key ? [key] : [];
          }),
          ...(include?.indexedKeys ?? []),
        ],
      },
      { signal: lifetime },
    );
    const citations = groupCitations(
      [...citekeys, ...wikilinks.occurrences].sort(
        (a, b) => a.position.start.offset - b.position.start.offset,
      ),
      (occurrence) =>
        occurrence.kind === "wikilink"
          ? (local.get(occurrence) ?? null)
          : this.#resolve(occurrence, file.path, lookup),
    );
    const occurrences = citations
      .flatMap((citation) => citation.occurrences)
      .sort((a, b) => a.position.start.offset - b.position.start.offset);
    const errors = wikilinks.malformed
      .filter(({ occurrence }) => local.get(occurrence) != null)
      .map(({ occurrence }) => ({
        kind: "malformed-wikilink" as const,
        occurrence,
      }));
    return { occurrences, citations, errors, lookup };
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
   * at layout-ready and runs asynchronously past it. A vault-wide consumer
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
    const lookup = listeners.use(this.#lookup.observe(() => onChange()));

    const publish = (): void => {
      if (disposed || this.#stopped || !published) return;
      lookup.set({ citekeys: this.citationKeys() });
      const next = this.#citedBy(
        indexedKey,
        (citekey) => heldResolution(lookup.current?.value ?? null, citekey),
        { includeNote, byPath: this.citationsByPath(["citekey", "wikilink"]) },
      );
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
    listeners.defer(this.#lookup.on("status-changed", onChange));
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
  async getCitedBy(
    indexedKey: string,
    answer?: CitationLookupAnswer,
  ): Promise<CitedBySnapshot> {
    const occurrences = this.citationsByPath(["citekey", "wikilink"]);
    const lookup =
      answer ??
      (await this.#lookup.read({
        citekeys: [...occurrences.values()].flatMap((citations) =>
          citations.flatMap((occurrence) =>
            occurrence.kind === "citekey" ? [occurrence.raw] : [],
          ),
        ),
      }));
    return this.#citedBy(indexedKey, (citekey) => lookup.resolve(citekey), {
      includeNote: () => true,
      byPath: occurrences,
    });
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
      void Promise.all([this.whenIndexed(), this.#lookup.whenResolved()]).then(
        () => {
          window.clearTimeout(timer);
          resolve("settled");
        },
      );
    });
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
      if (scanned && scanned.citekeys.length > 0) omitted.push("citekey");
    }
    if (!this.#includeWikilinkCitations) {
      const scan = await this.#coverFile(file);
      const occurrences = scan?.wikilinks ?? [];
      const malformed = scan?.malformedWikilinks ?? [];
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
   * The admitted Citation Occurrences of every covered document, by path —
   * the Document Citation Set membership {@link #admitted} gates, read
   * synchronously for a caller that redraws the whole vault in one pass: the
   * Graph Citations render facade.
   *
   * Reads what the backfill and the metadata events have covered so far, so
   * a document the backfill has not reached is absent until it is; the
   * `backfilled` event marks the pass complete. Occurrences are raw: what
   * each cites is the caller's question.
   *
   * @param syntaxes the Citation Syntaxes to answer with.
   * @returns paths holding at least one admitted occurrence, in vault order.
   */
  citationsByPath(
    syntaxes: readonly CitationSyntax[],
  ): ReadonlyMap<string, readonly CitationOccurrence[]> {
    const wantCitekeys = syntaxes.includes("citekey");
    const wantWikilinks = syntaxes.includes("wikilink");
    const byPath = new Map<string, readonly CitationOccurrence[]>();
    for (const file of this.#app.vault.getMarkdownFiles()) {
      const admitted = this.#admitted(this.#covered(file));
      const citekeys = wantCitekeys ? admitted.citekeys : [];
      const occurrences = wantWikilinks
        ? [...citekeys, ...admitted.wikilinks.occurrences]
        : citekeys;
      if (occurrences.length > 0) byPath.set(file.path, occurrences);
    }
    return byPath;
  }

  /**
   * Waits for a one-shot readiness signal, which disposal settles too: the pass
   * that would emit the signal returns early once the service is stopped, so a
   * caller torn down alongside the service would otherwise wait on nothing.
   */
  #waitFor(event: "backfilled", settled: boolean): Promise<void> {
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
    this.#filesByCitekey.clear();
    this.#annotationsByKey.clear();
    for (const pending of this.#pending.values()) pending.stop.abort();
    this.#pending.clear();
    this.#generations.clear();
    this.#failed.clear();
    this.#backfilled = false;
    this.#backfillFailed = false;
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
          void this.#scan(file, data).catch((error: unknown) => {
            if (!this.#stopped)
              logger.error("Citation parse failed", { error });
          });
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
    // A store that fails to open leaves the index whole and unpersisted, so the
    // failure costs a rescan per launch rather than the feature.
    try {
      this.#store = stack.use(await this.#openStore(this.#app));
      const loaded = await this.#store.load();
      let restored = 0;
      for (const { path, ...scan } of loaded) {
        // Pending replacements keep the saved scan available until they land.
        if (!this.#scans.has(path) && !this.#restoreInvalidated?.has(path)) {
          this.#setScan(path, scan);
          restored += 1;
        }
      }
      logger.debug("Citation index store loaded", {
        count: loaded.length,
        restored,
      });
    } catch (error) {
      logger.error("Citation index store unavailable", { error });
    } finally {
      this.#restoreInvalidated = null;
    }

    // The vault holds no files before layout-ready, and `onLayoutReady` is a
    // one-shot with no unregister, so the run gates on disposal instead.
    workspace.onLayoutReady(() => void this.#runBackfill());

    // Registered last so it runs first on disposal (stack is LIFO): the flag
    // must flip before the store and listeners tear down, so a persist or a
    // db-driven rebuild still in flight during the async disposal window
    // no-ops instead of writing to a closed store or emitting mid-disposal.
    stack.defer(() => {
      this.#stopped = true;
      this.#stop.abort();
      for (const wake of this.#waiters) wake();
    });
    this.commit(stack.move());
  }

  /** Readiness settles even on a failed pass, so no consumer waits forever. */
  async #runBackfill(): Promise<void> {
    const build = this.#build;
    if (this.#backfillBuild === build) return;
    this.#backfillBuild = build;
    logger.debug("Citation index backfill started", { build });
    try {
      await this.#backfill(build);
    } catch (error) {
      logger.error("Citation index backfill failed", { error });
      if (this.#stale(build)) return;
      this.#backfillFailed = true;
    }
    if (this.#stopped || build !== this.#build) return;
    logger.debug("Citation index backfilled", { count: this.#scans.size });
    this.#backfilled = true;
    this.#emitter.emit("backfilled");
  }

  async #backfill(build: number): Promise<void> {
    await Effect.runPromise(
      Effect.forEach(
        this.#app.vault.getMarkdownFiles(),
        (file) =>
          Effect.suspend(() => {
            if (this.#stale(build)) return Effect.void;
            return Effect.tryPromise(() =>
              this.#coverFile(file, true, build),
            ).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  if (this.#stale(build)) return;
                  this.#setFailed(file.path, true);
                  logger.warn("Citation backfill could not parse note", {
                    path: file.path,
                    error,
                  });
                }),
              ),
            );
          }),
        { concurrency: BACKFILL_CONCURRENCY, discard: true },
      ).pipe(Effect.scoped),
      { signal: this.#stop.signal },
    );
    if (this.#stale(build)) return;
    const present = new Set(
      this.#app.vault.getMarkdownFiles().map((file) => file.path),
    );
    for (const path of this.#scans.keys().toArray()) {
      if (!present.has(path)) this.#drop(path);
    }
  }

  /** Whether a build other than `build` has taken over. */
  #stale(build: number): boolean {
    return this.#stopped || build !== this.#build;
  }

  #scan(file: TFile, body: string): Promise<FileScan | null> {
    const { path } = file;
    const { mtime, size } = file.stat;
    const generation = ++this.#generation;
    const build = this.#build;
    this.#pending.get(path)?.stop.abort();
    this.#generations.set(path, generation);
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, this.#stop.signal]);
    const pending = {
      path,
      generation,
      stop,
      promise: abortable(
        this.#parseClient.parse({ path, generation, text: body }, signal),
        signal,
      )
        .then(({ record, path: replyPath, generation: replyGeneration }) => {
          const currentPath = pending.path;
          if (
            this.#stale(build) ||
            this.#generations.get(currentPath) !== generation ||
            replyPath !== path ||
            replyGeneration !== generation
          )
            return null;
          const scan: FileScan = {
            mtime,
            size,
            scannerRevision: SCANNER_REVISION,
            citekeys: record.citekeys,
            wikilinks: record.wikilinks,
            malformedWikilinks: record.malformedWikilinks,
            annotations: record.annotations,
            malformedAnnotationCitations: record.malformedAnnotationCitations,
          };
          const prev = this.#scans.get(currentPath);
          const same = scanContentEqual(prev, scan);
          if (
            same &&
            prev?.mtime === mtime &&
            prev.size === size &&
            prev.scannerRevision === SCANNER_REVISION
          ) {
            this.#setFailed(currentPath, false);
            return prev;
          }
          this.#setScan(currentPath, scan);
          this.#persist({ path: currentPath, ...scan });
          this.#setFailed(currentPath, false);
          if (!same) this.#emitter.emit("changed", currentPath);
          return scan;
        })
        .catch((error: unknown) => {
          if (signal.aborted) return null;
          this.#setFailed(pending.path, true);
          const retained = this.#scans.get(pending.path);
          if (retained) {
            logger.warn("Citation parse failed; retaining saved scan", {
              path: pending.path,
              error,
            });
            return retained;
          }
          throw error;
        })
        .finally(() => {
          if (this.#pending.get(pending.path) === pending)
            this.#pending.delete(pending.path);
        }),
    };
    this.#pending.set(path, pending);
    return pending.promise;
  }

  get #coverage(): CitationCoverage {
    if (!this.#backfilled) return "indexing";
    return this.#backfillFailed || this.#failed.size > 0
      ? "degraded"
      : "complete";
  }

  #setFailed(path: string, failed: boolean): void {
    const coverage = this.#coverage;
    if (failed) this.#failed.add(path);
    else this.#failed.delete(path);
    if (this.#coverage !== coverage) this.#emitter.emit("cited-by-invalidated");
  }

  #covered(file: TFile): FileScan | null {
    const scan = this.#scans.get(file.path);
    if (!scan) return null;
    const { mtime, size } = file.stat;
    return (scan.mtime === mtime && scan.size === size) ||
      this.#pending.has(file.path) ||
      this.#failed.has(file.path)
      ? scan
      : null;
  }

  async #coverFile(
    file: TFile,
    fresh = false,
    build = this.#build,
  ): Promise<FileScan | null> {
    while (!this.#stale(build)) {
      if (!this.#app.vault.getFileByPath(file.path)) return null;
      const known = this.#covered(file);
      // A grammar update keeps the last scan available while its replacement runs.
      if (!fresh && known && known.scannerRevision !== SCANNER_REVISION)
        return known;
      const pending = this.#pending.get(file.path);
      if (pending) {
        await pending.promise;
        continue;
      }
      if (this.#failed.has(file.path)) return known;
      if (known && (!fresh || known.scannerRevision === SCANNER_REVISION))
        return known;
      if (!this.#app.vault.getFileByPath(file.path)) return null;
      const path = file.path;
      const generation = this.#generations.get(path);
      const { mtime, size } = file.stat;
      const body = await this.#app.vault.cachedRead(file);
      if (this.#stale(build)) return null;
      if (
        file.path !== path ||
        this.#generations.get(path) !== generation ||
        file.stat.mtime !== mtime ||
        file.stat.size !== size
      )
        continue;
      if (!this.#app.vault.getFileByPath(path)) return null;
      await this.#scan(file, body);
    }
    return null;
  }

  #drop(path: string): void {
    this.#restoreInvalidated?.add(path);
    this.#setFailed(path, false);
    this.#generations.set(path, ++this.#generation);
    this.#pending.get(path)?.stop.abort();
    this.#pending.delete(path);
    const scan = this.#scans.get(path);
    if (!scan) return;
    this.#removeScan(path);
    this.#forget(path);
    if (!scanContentEqual(undefined, scan)) this.#emitter.emit("changed", path);
  }

  #move(oldPath: string, path: string): void {
    if (this.#failed.delete(oldPath)) this.#failed.add(path);
    this.#restoreInvalidated?.add(oldPath);
    this.#restoreInvalidated?.add(path);
    this.#generations.set(oldPath, ++this.#generation);
    const pending = this.#pending.get(oldPath);
    if (pending) {
      this.#pending.delete(oldPath);
      this.#pending.get(path)?.stop.abort();
      pending.path = path;
      this.#pending.set(path, pending);
      this.#generations.set(path, pending.generation);
    }
    const scan = this.#scans.get(oldPath);
    if (!scan) return;
    this.#removeScan(oldPath);
    this.#setScan(path, scan);
    this.#forget(oldPath);
    this.#persist({ path, ...scan });
    if (!scanContentEqual(undefined, scan)) this.#emitter.emit("changed", path);
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

  #admitted(scan: FileScan | null) {
    return {
      citekeys: this.#includePandocCitations ? (scan?.citekeys ?? []) : [],
      wikilinks: {
        occurrences: this.#includeWikilinkCitations
          ? (scan?.wikilinks ?? [])
          : [],
        malformed: this.#includeWikilinkCitations
          ? (scan?.malformedWikilinks ?? [])
          : [],
      },
    };
  }

  citationKeys(): string[] {
    return [...this.#filesByCitekey.keys()];
  }

  get coverage(): CitationCoverage {
    return this.#coverage;
  }

  /** Synchronous stored facts, in path order and then document order. */
  getAnnotationUses(indexedKey: string): readonly AnnotationUse[] {
    const paths = this.#annotationsByKey.get(indexedKey);
    if (!paths) return [];
    return [...paths]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([path, occurrences]) =>
        occurrences.map((occurrence) => ({ path, occurrence })),
      );
  }

  #setScan(path: string, scan: FileScan): void {
    this.#removeScan(path);
    this.#scans.set(path, scan);
    for (const { raw } of scan.citekeys) {
      const paths = this.#filesByCitekey.get(raw) ?? new Set<string>();
      paths.add(path);
      this.#filesByCitekey.set(raw, paths);
    }
    for (const occurrence of scan.annotations) {
      const paths =
        this.#annotationsByKey.get(occurrence.indexedKey) ??
        new Map<string, AnnotationOccurrence[]>();
      const occurrences = paths.get(path) ?? [];
      occurrences.push(occurrence);
      paths.set(path, occurrences);
      this.#annotationsByKey.set(occurrence.indexedKey, paths);
    }
  }

  #removeScan(path: string): void {
    const scan = this.#scans.get(path);
    if (!scan) return;
    this.#scans.delete(path);
    for (const { raw } of scan.citekeys) {
      const paths = this.#filesByCitekey.get(raw);
      paths?.delete(path);
      if (paths?.size === 0) this.#filesByCitekey.delete(raw);
    }
    for (const { indexedKey } of scan.annotations) {
      const paths = this.#annotationsByKey.get(indexedKey);
      paths?.delete(path);
      if (paths?.size === 0) this.#annotationsByKey.delete(indexedKey);
    }
  }

  #citedBy(
    indexedKey: string,
    resolve: (citekey: string) => CitekeyResolution | null,
    {
      includeNote,
      byPath,
    }: {
      includeNote: (file: TFile) => boolean;
      byPath: ReadonlyMap<string, readonly CitationOccurrence[]>;
    },
  ): CitedBySnapshot {
    const groups: CitedByGroup[] = [];
    const files = this.#app.vault
      .getMarkdownFiles()
      .filter(includeNote)
      .sort((a, b) => comparePaths(a.path, b.path));
    for (const file of files) {
      const occurrences = (byPath.get(file.path) ?? [])
        .filter((occurrence) =>
          occurrence.kind === "citekey"
            ? this.#citekeyOccurrenceCites(resolve(occurrence.raw), indexedKey)
            : this.#wikilinkOccurrenceCites(occurrence, file.path, indexedKey),
        )
        .sort(compareOccurrences);
      if (occurrences.length > 0) {
        groups.push({ path: file.path, occurrences });
      }
    }
    return {
      groups,
      coverage: this.#coverage,
      resolution:
        this.#lookup.status === "pending" ? null : this.#lookup.status,
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
  async citedByOmittedSyntaxes(
    indexedKey: string,
    answer?: CitationLookupAnswer,
  ): Promise<CitationSyntax[]> {
    await this.ready;
    const files = this.#app.vault.getMarkdownFiles();
    const omitted: CitationSyntax[] = [];
    const citekeys = files.flatMap(
      (file) => this.#covered(file)?.citekeys ?? [],
    );
    const lookup =
      answer ??
      (await this.#lookup.read({
        citekeys: citekeys.map((occurrence) => occurrence.raw),
      }));
    if (!this.#includePandocCitations) {
      const held = citekeys.some((occurrence) =>
        this.#citekeyOccurrenceCites(
          lookup.resolve(occurrence.raw),
          indexedKey,
        ),
      );
      if (held) omitted.push("citekey");
    }
    if (!this.#includeWikilinkCitations) {
      const held = files.some((file) => {
        return (this.#covered(file)?.wikilinks ?? []).some((occurrence) =>
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
    resolved: CitekeyResolution | null,
    indexedKey: string,
  ): boolean {
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
    lookup?: CitationLookupAnswer,
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
    const resolved = lookup!.resolve(occurrence.raw);
    const item = resolved.kind === "unique" ? resolved.item : null;
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

function scanContentEqual(
  previous: FileScan | undefined,
  next: FileScan,
): boolean {
  return (
    occurrencesEqual(previous?.citekeys ?? [], next.citekeys) &&
    occurrencesEqual(previous?.wikilinks ?? [], next.wikilinks) &&
    occurrencesEqual(
      (previous?.malformedWikilinks ?? []).map(({ occurrence }) => occurrence),
      next.malformedWikilinks.map(({ occurrence }) => occurrence),
    ) &&
    JSON.stringify(previous?.annotations ?? []) ===
      JSON.stringify(next.annotations) &&
    JSON.stringify(previous?.malformedAnnotationCitations ?? []) ===
      JSON.stringify(next.malformedAnnotationCitations)
  );
}
