// The renderer owns persisted note scans and citation membership; the parse client owns Markdown.

import { abortable } from "@std/async/abortable";
import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { Clock, Effect, Option } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { PlainPluginSettings } from "@/services/settings/plain";
import type { Settings } from "@/services/settings/schema";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import { heldResolution } from "./lookup";
import type { CitationLookup, CitationLookupStatus } from "./lookup-service";
export type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
export type { CitationLookupObservation } from "./lookup-service";

import type { PlainCitationParse } from "@/services/citation-parse/plain";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { describeJoinedCandidates } from "./ambiguity";
import { citationOutcome } from "./outcome";
import type { CitationOutcome } from "./outcome";
import { annotationCitations, readParsedNote } from "./parsed-note";
import type { ParsedNote } from "./parsed-note";
import { groupCitations } from "./query";
import type { Citation, ResolvedNote } from "./query";
import { occurrencesEqual } from "./scan";
import type { CitationOccurrence, CitationSyntax } from "./scan";
import type { AnnotationOccurrence } from "./scan-note";
import type { CitekeyResolution } from "./snapshot";
import { readReferenceSources } from "./sources";
import type { ReferenceSourceJoin } from "./sources";
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

type CitationRecord = Pick<
  FileScan,
  | "citekeys"
  | "wikilinks"
  | "malformedWikilinks"
  | "annotations"
  | "malformedAnnotationCitations"
>;

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
export interface DocumentCitationSet extends ReferenceSourceJoin {
  syntaxes: CitationSyntaxes;
  omittedSyntaxes: CitationSyntax[];
  coverage: CitationCoverage;
  /** Eligible occurrences in document order, including repeated works. */
  occurrences: CitationOccurrence[];
  /** The same occurrences grouped for reference-list consumers. */
  citations: Citation[];
  /** Invalid explicit citation intent, excluded from CSL membership. */
  errors: DocumentCitationError[];
  /** The citation lookup used to compose this document, at one revision. */
  lookup: CitationLookupAnswer;
}

/** One citation source error a document-aware surface can help correct. */
export interface DocumentCitationError {
  outcome?: CitationOutcome;
  kind: "malformed-wikilink" | "malformed-annotation";
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
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  db: Pick<ZoteroReadsService, "state" | "acquireRead">;
  libraryScope: Pick<LibraryScopeService, "current">;
  parseClient: Pick<PlainCitationParse, "parse">;
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  settings: Pick<PlainPluginSettings, "current" | "subscribe">;
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
  readonly #db;
  readonly #libraryScope;
  readonly #noteIndex;
  readonly #settings;
  readonly #lookup;
  readonly #openStore;
  readonly #parseClient;
  readonly #runPromise;
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
  #includeAnnotationCitations = true;
  #backfilled = false;
  #backfillBuild = -1;
  #backfillFailed = false;
  #stopped = false;
  readonly #stop = new AbortController();

  ready: Promise<void>;

  constructor(options: CitationIndexOptions) {
    super();
    this.#parseClient = options.parseClient;
    this.#runPromise = options.runPromise;
    this.#db = options.db;
    this.#libraryScope = options.libraryScope;
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#settings = options.settings;
    this.#lookup = options.lookup;
    this.#openStore = options.openStore ?? openCitekeyStore;
    this.ready = this.#load();
  }

  /** Wait for the file's pending parse; stale retained scans cannot validate navigation. */
  async getFileScan(file: TFile): Promise<Readonly<FileScan> | null> {
    await this.ready;
    const scan = await this.#coverFile(file);
    return scan &&
      scan.mtime === file.stat.mtime &&
      scan.size === file.stat.size
      ? scan
      : null;
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
      parsed,
    }: {
      signal?: AbortSignal;
      include?: CitationLookupRequest;
      parsed?: ParsedNote;
    } = {},
  ): Promise<DocumentCitationSet> {
    const lifetime = signal
      ? AbortSignal.any([signal, this.#stop.signal])
      : this.#stop.signal;
    lifetime.throwIfAborted();
    await abortable(this.ready, lifetime);
    const scan =
      parsed?.record ?? (await abortable(this.#coverFile(file), lifetime));
    return this.#composeDocument(file, scan, {
      lifetime,
      include,
      syntaxes: this.syntaxes(),
      coverage: this.#coverage,
    });
  }

  async #composeDocument(
    file: TFile,
    scan: CitationRecord | null,
    {
      lifetime,
      include,
      syntaxes,
      coverage,
    }: {
      lifetime: AbortSignal;
      include?: CitationLookupRequest;
      syntaxes: CitationSyntaxes;
      coverage: CitationCoverage;
    },
  ): Promise<DocumentCitationSet> {
    const { citekeys, wikilinks, annotations, malformedAnnotations } =
      this.#admitted(scan, syntaxes);
    const omittedSyntaxes = this.#omittedDocument(scan, file.path, syntaxes);
    const local = new Map<CitationOccurrence, ResolvedNote | null>(
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
        annotationKeys: [
          ...annotations.map((occurrence) => occurrence.raw),
          ...(include?.annotationKeys ?? []),
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
      [...citekeys, ...wikilinks.occurrences, ...annotations].sort(
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
    const errors: DocumentCitationError[] = wikilinks.malformed
      .filter(({ occurrence }) => local.get(occurrence) != null)
      .map(({ occurrence }) => ({
        kind: "malformed-wikilink" as const,
        occurrence,
      }));
    errors.push(
      ...malformedAnnotations.map(
        ({ destination, position }): DocumentCitationError => ({
          kind: "malformed-annotation",
          occurrence: { kind: "annotation", raw: destination, position },
        }),
      ),
    );
    errors.sort((a, b) => compareOccurrences(a.occurrence, b.occurrence));
    const candidates = [
      ...new Set([
        ...citekeys.map((occurrence) => occurrence.raw),
        ...(include?.citekeys ?? []),
      ]),
    ].flatMap((citekey) => {
      const resolved = lookup.resolve(citekey);
      return resolved.kind === "ambiguous" ? [...resolved.candidates] : [];
    });
    const libraries = new Map(
      (this.#libraryScope.current?.available ?? []).map((library) => [
        library.libraryID,
        library,
      ]),
    );
    const citedKeys = new Set(citations.map(({ indexedKey }) => indexedKey));
    const joined = await readReferenceSources(this.#db, [
      ...citations,
      ...candidates
        .filter(({ indexedKey }) => !citedKeys.has(indexedKey))
        .map(({ indexedKey }) => ({ indexedKey, linkpath: null })),
    ]);
    for (const citation of citations) {
      const first = citation.occurrences[0]!;
      const resolved =
        first.kind === "citekey" ? lookup.resolve(first.raw) : null;
      citation.outcome = citationOutcome(citation, {
        sources: joined.sources,
        presentKeys: joined.presentKeys,
        database: joined.database,
        resolution: resolved,
        candidates:
          resolved?.kind === "ambiguous"
            ? describeJoinedCandidates(
                resolved.candidates,
                joined.sources,
                libraries,
              )
            : [],
      });
    }
    for (const error of errors) error.outcome = { kind: "malformed" };
    return {
      occurrences,
      citations,
      errors,
      lookup,
      ...joined,
      syntaxes,
      omittedSyntaxes,
      coverage,
    };
  }

  getParsedNote(file: TFile, signal = this.#stop.signal): Promise<ParsedNote> {
    return readParsedNote(file, {
      vault: this.#app.vault,
      parser: this.#parseClient,
      signal,
    });
  }

  async getParsedDocument(file: TFile, signal = this.#stop.signal) {
    for (;;) {
      const generation = this.#generations.get(file.path);
      const { mtime, size } = file.stat;
      const facts = await this.getParsedNote(file, signal);
      const set = await this.getDocumentCitationSet(file, {
        signal,
        parsed: facts,
      });
      if (
        generation === this.#generations.get(file.path) &&
        mtime === file.stat.mtime &&
        size === file.stat.size
      )
        return { facts, set };
    }
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
      lookup.set({
        citekeys: this.citationKeys(),
        annotationKeys: this.annotationCitationKeys(),
      });
      const next = this.#citedBy(
        indexedKey,
        {
          resolve: (citekey) =>
            heldResolution(lookup.current?.value ?? null, citekey),
          parentOfAnnotation: (key) => {
            const answer = lookup.current?.value;
            return answer?.coversAnnotationKey(key)
              ? (answer.parentOfAnnotation(key)?.indexedKey ?? null)
              : null;
          },
        },
        {
          includeNote,
          byPath: this.citationsByPath(["citekey", "wikilink", "annotation"]),
        },
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
    const occurrences = this.citationsByPath([
      "citekey",
      "wikilink",
      "annotation",
    ]);
    const lookup =
      answer ??
      (await this.#lookup.read({
        annotationKeys: this.annotationCitationKeys(),
        citekeys: [...occurrences.values()].flatMap((citations) =>
          citations.flatMap((occurrence) =>
            occurrence.kind === "citekey" ? [occurrence.raw] : [],
          ),
        ),
      }));
    return this.#citedBy(
      indexedKey,
      {
        resolve: (citekey) => lookup.resolve(citekey),
        parentOfAnnotation: (key) =>
          lookup.parentOfAnnotation(key)?.indexedKey ?? null,
      },
      {
        includeNote: () => true,
        byPath: occurrences,
      },
    );
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
    return this.#runPromise(this.#settle(timeoutMs));
  }

  readonly #settle = Effect.fn("CitationIndex.settle")(
    function* (this: CitationIndex, timeoutMs: number) {
      if (timeoutMs <= 0) return "timeout" as const;
      yield* Effect.all(
        [
          Effect.promise(() => this.whenIndexed()),
          Effect.promise(() => this.#lookup.whenResolved()),
        ],
        { concurrency: "unbounded" },
      );
      while (this.#pending.size > 0) {
        yield* Effect.promise(() =>
          Promise.allSettled(
            [...this.#pending.values()].map((pending) => pending.promise),
          ),
        );
      }
      return "settled" as const;
    },
    (effect, timeoutMs) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: Math.max(0, timeoutMs),
          orElse: () => Effect.succeed("timeout" as const),
        }),
      ),
  ).bind(this);

  readonly #capture = Effect.fn("CitationIndex.capture")(function* (
    this: CitationIndex,
    timeoutMs: number,
  ) {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    for (;;) {
      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if ((yield* this.#settle(remaining)) === "timeout") return null;
      const files = this.#app.vault.getMarkdownFiles();
      const stale = files.filter(
        (file) => !this.#covered(file) && !this.#failed.has(file.path),
      );
      if (stale.length === 0) {
        return {
          scans: new Map(
            files.flatMap((file) => {
              const scan = this.#covered(file);
              return scan ? [[file.path, scan] as const] : [];
            }),
          ),
          syntaxes: this.syntaxes(),
          coverage: this.#coverage,
        };
      }
      const refreshed = yield* Effect.forEach(
        stale,
        (file) => Effect.tryPromise(() => this.#coverFile(file)),
        { concurrency: BACKFILL_CONCURRENCY },
      ).pipe(Effect.timeoutOption(deadline - (yield* Clock.currentTimeMillis)));
      if (Option.isNone(refreshed)) return null;
    }
  }).bind(this);

  readAnnotationUses = Effect.fn("CitationIndex.readAnnotationUses")(function* (
    this: CitationIndex,
    key: string,
    timeoutMs: number,
  ) {
    const captured = yield* this.#capture(timeoutMs);
    if (!captured) return { kind: "timeout", coverage: "indexing" } as const;
    return {
      kind: "ready",
      uses: [...captured.scans]
        .sort(([left], [right]) => comparePaths(left, right))
        .flatMap(([path, scan]) =>
          scan.annotations
            .filter((occurrence) => occurrence.indexedKey === key)
            .map((occurrence) => ({ path, occurrence })),
        ),
      coverage: captured.coverage,
    } as const;
  }).bind(this);

  readReferences = Effect.fn("CitationIndex.readReferences")(function* (
    this: CitationIndex,
    path: string,
    timeoutMs: number,
  ) {
    const captured = yield* this.#capture(timeoutMs);
    if (!captured) return { kind: "timeout", coverage: "indexing" } as const;
    const file = this.#app.vault.getFileByPath(path);
    const scan = captured.scans.get(path) ?? null;
    const document =
      file?.extension === "md"
        ? yield* Effect.tryPromise(() =>
            this.#composeDocument(file, scan, {
              ...captured,
              lifetime: this.#stop.signal,
            }),
          )
        : null;
    return { kind: "ready", document } as const;
  }).bind(this);

  readCitedBy = Effect.fn("CitationIndex.readCitedBy")(function* (
    this: CitationIndex,
    selector: { key: string } | { citekey: string },
    timeoutMs: number,
  ) {
    const snapshot = yield* this.#capture(timeoutMs);
    if (!snapshot) return { kind: "timeout", coverage: "indexing" } as const;
    const { syntaxes, coverage } = snapshot;
    const captured = [...snapshot.scans]
      .sort(([left], [right]) => comparePaths(left, right))
      .map(([path, scan]) => ({
        path,
        occurrences: [
          ...scan.citekeys,
          ...scan.wikilinks,
          ...annotationCitations(scan),
        ].sort(compareOccurrences),
      }));
    const local = new Map(
      captured.flatMap(({ path, occurrences }) =>
        occurrences
          .filter((o) => o.kind === "wikilink")
          .map((o) => [o, this.#resolve(o, path)?.indexedKey ?? null] as const),
      ),
    );
    const lookup = yield* Effect.tryPromise(() =>
      this.#lookup.read({
        citekeys: [
          ...captured.flatMap(({ occurrences }) =>
            occurrences.filter((o) => o.kind === "citekey").map((o) => o.raw),
          ),
          ...("citekey" in selector ? [selector.citekey] : []),
        ],
        annotationKeys: captured.flatMap(({ occurrences }) =>
          occurrences.filter((o) => o.kind === "annotation").map((o) => o.raw),
        ),
        indexedKeys: "key" in selector ? [selector.key] : [],
      }),
    );
    let key: string;
    let citekey: string | null;
    if ("key" in selector) {
      key = selector.key;
      citekey = lookup.citekeyOf(key);
    } else {
      citekey = selector.citekey;
      const resolved = lookup.resolve(citekey);
      if (resolved.kind === "missing")
        return { kind: "unresolved", citekey } as const;
      if (resolved.kind === "ambiguous")
        return {
          kind: "ambiguous",
          citekey,
          candidates: resolved.candidates,
        } as const;
      key = resolved.item.indexedKey;
    }
    const joined = yield* Effect.promise(() =>
      readReferenceSources(this.#db, [{ indexedKey: key, linkpath: null }]),
    );
    if (joined.database === "ready" && !joined.presentKeys.has(key))
      return { kind: "missing", key } as const;
    const groups: CitedByGroup[] = [];
    const omitted = new Set<CitationSyntax>();
    for (const { path, occurrences } of captured) {
      const included: CitationOccurrence[] = [];
      for (const occurrence of occurrences) {
        const cites =
          occurrence.kind === "citekey"
            ? this.#citekeyOccurrenceCites(lookup.resolve(occurrence.raw), key)
            : occurrence.kind === "annotation"
              ? lookup.parentOfAnnotation(occurrence.raw)?.indexedKey === key
              : local.get(occurrence) === key;
        if (!cites) continue;
        if (syntaxes[occurrence.kind] === "included") included.push(occurrence);
        else omitted.add(occurrence.kind);
      }
      if (included.length) groups.push({ path, occurrences: included });
    }
    return {
      kind: "ready",
      groups,
      syntaxes,
      coverage,
      resolution: "fresh" as const,
      omittedSyntaxes: (["citekey", "wikilink", "annotation"] as const).filter(
        (syntax) => omitted.has(syntax),
      ),
      item: {
        key,
        citekey,
        summary: joined.sources.get(key)?.summary ?? null,
      },
    } as const;
  }).bind(this);

  /**
   * Which Citation Syntaxes admit their occurrences into an answer, for a
   * caller that declares the constraint beside its facts — the agent-facing
   * CLI. Follows the same source choices {@link #admitted} applies to the
   * document set and Cited By.
   */
  syntaxes(): CitationSyntaxes {
    return {
      citekey: this.#includePandocCitations ? "included" : "excluded",
      wikilink: this.#includeWikilinkCitations ? "included" : "excluded",
      annotation: this.#includeAnnotationCitations ? "included" : "excluded",
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
    const scan = await this.#coverFile(file);
    return this.#omittedDocument(scan, file.path, this.syntaxes());
  }

  #omittedDocument(
    scan: Pick<
      FileScan,
      | "citekeys"
      | "wikilinks"
      | "malformedWikilinks"
      | "annotations"
      | "malformedAnnotationCitations"
    > | null,
    path: string,
    syntaxes: CitationSyntaxes,
  ): CitationSyntax[] {
    const omitted: CitationSyntax[] = [];
    if (syntaxes.citekey === "excluded" && scan?.citekeys.length)
      omitted.push("citekey");
    if (
      syntaxes.wikilink === "excluded" &&
      [
        ...(scan?.wikilinks ?? []),
        ...(scan?.malformedWikilinks.map(({ occurrence }) => occurrence) ?? []),
      ].some((occurrence) => this.#resolve(occurrence, path) !== null)
    )
      omitted.push("wikilink");
    if (
      syntaxes.annotation === "excluded" &&
      (scan?.annotations.some(({ form }) => form === "citation") ||
        scan?.malformedAnnotationCitations.length)
    )
      omitted.push("annotation");
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
    const wantAnnotations = syntaxes.includes("annotation");
    const byPath = new Map<string, readonly CitationOccurrence[]>();
    for (const file of this.#app.vault.getMarkdownFiles()) {
      const admitted = this.#admitted(this.#covered(file));
      const citekeys = wantCitekeys ? admitted.citekeys : [];
      const occurrences = [
        ...citekeys,
        ...(wantWikilinks ? admitted.wikilinks.occurrences : []),
        ...(wantAnnotations ? admitted.annotations : []),
      ];
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

  #admitted(scan: CitationRecord | null, syntaxes = this.syntaxes()) {
    return {
      annotations:
        syntaxes.annotation === "included" ? annotationCitations(scan) : [],
      malformedAnnotations:
        syntaxes.annotation === "included"
          ? (scan?.malformedAnnotationCitations ?? [])
          : [],
      citekeys: syntaxes.citekey === "included" ? (scan?.citekeys ?? []) : [],
      wikilinks: {
        occurrences:
          syntaxes.wikilink === "included" ? (scan?.wikilinks ?? []) : [],
        malformed:
          syntaxes.wikilink === "included"
            ? (scan?.malformedWikilinks ?? [])
            : [],
      },
    };
  }

  citationKeys(): string[] {
    return [...this.#filesByCitekey.keys()];
  }

  annotationCitationKeys(): string[] {
    return [...this.#annotationsByKey].flatMap(([key, paths]) =>
      [...paths.values()].some((occurrences) =>
        occurrences.some(({ form }) => form === "citation"),
      )
        ? [key]
        : [],
    );
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
    {
      resolve,
      parentOfAnnotation,
    }: {
      resolve: (citekey: string) => CitekeyResolution | null;
      parentOfAnnotation: (key: string) => string | null;
    },
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
            : occurrence.kind === "annotation"
              ? parentOfAnnotation(occurrence.raw) === indexedKey
              : this.#wikilinkOccurrenceCites(
                  occurrence,
                  file.path,
                  indexedKey,
                ),
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
        annotationKeys: this.annotationCitationKeys(),
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
    if (
      !this.#includeAnnotationCitations &&
      this.annotationCitationKeys().some(
        (key) => lookup.parentOfAnnotation(key)?.indexedKey === indexedKey,
      )
    )
      omitted.push("annotation");
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
    if (occurrence.kind === "annotation") {
      const parent = lookup!.parentOfAnnotation(occurrence.raw);
      if (!parent) return null;
      const [note] = this.#noteIndex.getNotesByItemKey(parent.indexedKey);
      return { indexedKey: parent.indexedKey, linkpath: note?.path ?? null };
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
    const nextAnnotations = settings["citation.annotation-citations"];
    const membershipChanged =
      nextPandoc !== this.#includePandocCitations ||
      nextWikilinks !== this.#includeWikilinkCitations ||
      nextAnnotations !== this.#includeAnnotationCitations;
    if (!membershipChanged) return;
    this.#includePandocCitations = nextPandoc;
    this.#includeWikilinkCitations = nextWikilinks;
    this.#includeAnnotationCitations = nextAnnotations;
    logger.debug("Citation source membership changed", {
      pandocCitations: nextPandoc,
      wikilinkCitations: nextWikilinks,
      annotationCitations: nextAnnotations,
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
