// The renderer owns persisted note scans and citation membership; the parse client owns Markdown.

import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PubSub,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { TFile } from "obsidian";
import type { TAbstractFile } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { startupBarrier } from "@/lib/effect-startup";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import type { VaultEvent } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import type { VaultError } from "@/lib/vault-errors";
import type {
  ParseFailed,
  ParseWorkerDied,
} from "@/services/citation-parse/client";
import { CitationParse } from "@/services/citation-parse/service";
import { LibraryScope } from "@/services/library-scope/service";
import {
  NoteIndex,
  resolveLiteratureNoteIn,
} from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
import { heldResolution } from "./lookup";
import { CitationLookup } from "./lookup-service";
import type { CitationLookupStatus } from "./lookup-service";
export type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";
export type { CitationLookupObservation } from "./lookup-service";

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

const BACKFILL_CONCURRENCY = 4;
export interface CitationIndexState {
  readonly backfilled: boolean;
  readonly backfillFailed: boolean;
  readonly coverage: CitationCoverage;
  readonly stopped: boolean;
  readonly syntaxes: CitationSyntaxes;
}
export type CitationIndexEvent =
  | { readonly type: "changed"; readonly path: string }
  | { readonly type: "membership-changed" | "cited-by-invalidated" };

export class CitationIndex extends Context.Service<
  CitationIndex,
  Effect.Success<ReturnType<typeof makeCitationIndex>>
>()("zotlit/citation-index/CitationIndex") {}

export const layerCitationIndex = (openStore = openCitekeyStore) =>
  Layer.effect(CitationIndex, makeCitationIndex(openStore));

function makeCitationIndex(
  openStore: (appId: string) => Promise<CitekeyStore>,
) {
  return Effect.gen(function* () {
    const { appId } = yield* ObsidianEnv;
    const metadata = yield* MetadataCache;
    const workspace = yield* Workspace;
    const vault = yield* Vault;
    const db = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const noteIndex = yield* NoteIndex;
    const settings = yield* PluginSettings;
    const lookupService = yield* CitationLookup;
    const parser = yield* CitationParse;
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const bridge = yield* scopedBridge;
    const indexedKeyOf = Effect.fnUntraced(function* (
      linkpath: string,
      sourcePath: string,
    ) {
      return (
        (yield* resolveLiteratureNoteIn(metadata, linkpath, sourcePath))
          ?.indexedKey ?? null
      );
    });
    const recover = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logError("Citation index operation failed", cause),
        ),
        withLogCategory("citation-index"),
      );
    const log = (
      level: "debug" | "warn" | "error",
      message: string,
      fields: Record<string, unknown>,
    ) => {
      const write =
        level === "debug"
          ? Effect.logDebug
          : level === "warn"
            ? Effect.logWarning
            : Effect.logError;
      return write(message).pipe(
        Effect.annotateLogs(fields),
        withLogCategory("citation-index"),
      );
    };
    const joinSources = (
      citations: Parameters<typeof readReferenceSources>[1],
    ) => readReferenceSources(db, citations);
    const scans = new Map<string, FileScan>();
    const filesByCitekey = new Map<string, Set<string>>();
    const annotationsByKey = new Map<
      string,
      Map<string, AnnotationOccurrence[]>
    >();
    const failedPaths = new Set<string>();
    const generations = new Map<string, number>();
    let restoreInvalidated: Set<string> | null = new Set();
    const pendingScans = new Map<
      string,
      {
        path: string;
        generation: number;
        fiber: Fiber.Fiber<FileScan | null, ParseFailed | ParseWorkerDied>;
      }
    >();
    let nextGeneration = 0;
    let store: CitekeyStore | undefined;
    let activeBuildNumber = 0;
    const initial = yield* settings.current;
    let includePandocCitations = initial["citation.pandoc-citations"];
    let includeWikilinkCitations = initial["citation.wikilink-citations"];
    let includeAnnotationCitations = initial["citation.annotation-citations"];
    let backfilled = false;
    let backfillBuild = -1;
    let backfillFailed = false;
    let stopped = false;
    const state = yield* SubscriptionRef.make<CitationIndexState>({
      backfilled,
      backfillFailed,
      stopped,
      coverage: "indexing",
      syntaxes: syntaxes(),
    });
    const current = SubscriptionRef.get(state);
    const changes = SubscriptionRef.changes(state).pipe(
      Stream.takeUntil((value) => value.stopped),
    );
    const bus = yield* PubSub.unbounded<CitationIndexEvent>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
    const events = Stream.fromPubSub(bus);
    function publishState() {
      return SubscriptionRef.set(state, {
        backfilled,
        backfillFailed,
        stopped,
        coverage: getCoverage(),
        syntaxes: syntaxes(),
      });
    }
    // Runs per scanned file on the metadata intake and backfill hot path.
    const emit = Effect.fnUntraced(function* (
      type: CitationIndexEvent["type"] | "backfilled",
      path?: string,
    ) {
      if (type !== "changed") yield* publishState();
      if (type === "backfilled") return;
      PubSub.publishUnsafe(
        bus,
        type === "changed" ? { type, path: path! } : { type },
      );
    });
    /** Wait for the file's pending parse; stale retained scans cannot validate navigation. */
    const getFileScan = Effect.fn("CitationIndex.getFileScan")(function* (
      file: TFile,
    ) {
      const scan = yield* coverFile(file);
      return scan &&
        scan.mtime === file.stat.mtime &&
        scan.size === file.stat.size
        ? scan
        : null;
    });

    /**
     * The active document's shared citation membership and source order.
     *
     * A document the backfill has not reached is scanned on demand, so the
     * active document is answered without waiting for the vault-wide pass.
     */
    const getDocumentCitationSet = Effect.fn(
      "CitationIndex.getDocumentCitationSet",
    )(function* (
      file: TFile,
      {
        include,
        parsed,
      }: {
        include?: CitationLookupRequest;
        parsed?: ParsedNote;
      } = {},
    ) {
      const scan = parsed?.record ?? (yield* coverFile(file));
      return yield* composeDocument(file, scan, {
        include,
        syntaxes: syntaxes(),
        coverage: getCoverage(),
      });
    });

    const composeDocument = Effect.fn("CitationIndex.composeDocument")(
      function* (
        file: TFile,
        scan: CitationRecord | null,
        {
          include,
          syntaxes,
          coverage,
        }: {
          include?: CitationLookupRequest;
          syntaxes: CitationSyntaxes;
          coverage: CitationCoverage;
        },
      ): Effect.fn.Return<
        DocumentCitationSet,
        Effect.Error<ReturnType<typeof lookupService.read>>
      > {
        const { citekeys, wikilinks, annotations, malformedAnnotations } =
          admitted(scan, syntaxes);
        const omittedSyntaxes = yield* omittedDocument(
          scan,
          file.path,
          syntaxes,
        );
        const local = new Map<CitationOccurrence, ResolvedNote | null>();
        for (const occurrence of [
          ...wikilinks.occurrences,
          ...wikilinks.malformed.map(({ occurrence }) => occurrence),
        ])
          local.set(occurrence, yield* resolve(occurrence, file.path));
        const lookup = yield* lookupService.read({
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
        });
        const ordered = [
          ...citekeys,
          ...wikilinks.occurrences,
          ...annotations,
        ].sort((a, b) => a.position.start.offset - b.position.start.offset);
        for (const occurrence of [...citekeys, ...annotations])
          local.set(occurrence, yield* resolve(occurrence, file.path, lookup));
        const citations = groupCitations(
          ordered,
          (occurrence) => local.get(occurrence) ?? null,
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
          ((yield* libraryScope.current)?.available ?? []).map((library) => [
            library.libraryID,
            library,
          ]),
        );
        const citedKeys = new Set(
          citations.map(({ indexedKey }) => indexedKey),
        );
        const joined = yield* joinSources([
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
      },
    );

    const parsedNote = (file: TFile) =>
      readParsedNote(file).pipe(
        Effect.provideService(Vault, vault),
        Effect.provideService(CitationParse, parser),
      );

    const getParsedDocument = Effect.fn("CitationIndex.getParsedDocument")(
      function* (file: TFile) {
        for (;;) {
          const generation = generations.get(file.path);
          const { mtime, size } = file.stat;
          const facts = yield* parsedNote(file);
          const set = yield* getDocumentCitationSet(file, {
            parsed: facts,
          });
          if (
            generation === generations.get(file.path) &&
            mtime === file.stat.mtime &&
            size === file.stat.size
          )
            return { facts, set };
        }
      },
    );

    const whenIndexed = Stream.runHead(
      changes.pipe(Stream.filter((value) => value.backfilled || value.stopped)),
    ).pipe(Effect.asVoid, Effect.withSpan("CitationIndex.whenIndexed"));

    /**
     * Observe the citations in the vault that resolve to an Item, under the same
     * source choices as the Document Citation Set.
     * The first snapshot waits for listener registration; later snapshots follow
     * progressive scans, citation-key resolution changes, and source choices.
     */
    const observeCitedBy = Effect.fn("CitationIndex.observeCitedBy")(function* (
      indexedKey: string,
      callback: (snapshot: CitedBySnapshot) => void,
      includeNote: (file: TFile) => boolean = () => true,
    ): Effect.fn.Return<() => void> {
      if (stopped) return () => {};
      const observationScope = yield* Scope.fork(scope);
      let disposed = false;
      let queued = false;
      let previous: CitedBySnapshot | null = null;
      const onChange = () => {
        if (disposed || queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          bridge.runAndForget(publish().pipe(recover));
        });
      };
      const held = yield* Scope.provide(
        Effect.acquireDisposable(lookupService.observe(onChange)),
        observationScope,
      );
      const publish = Effect.fnUntraced(function* () {
        if (disposed || stopped) return;
        held.set({
          citekeys: citationKeys(),
          annotationKeys: annotationCitationKeys(),
        });
        const next = yield* citedBy(
          indexedKey,
          {
            resolve: (citekey) =>
              heldResolution(held.current?.value ?? null, citekey),
            parentOfAnnotation: (key) => {
              const answer = held.current?.value;
              return answer?.coversAnnotationKey(key)
                ? (answer.parentOfAnnotation(key)?.indexedKey ?? null)
                : null;
            },
          },
          {
            includeNote,
            byPath: yield* citationsByPath([
              "citekey",
              "wikilink",
              "annotation",
            ]),
          },
        );
        if (previous && citedBySnapshotsEqual(previous, next)) return;
        previous = next;
        yield* Effect.try(() => callback(next)).pipe(
          Effect.catch((error) =>
            log("warn", "Cited-by observer failed", { error }),
          ),
        );
      });
      yield* Effect.all([
        forkEach(events, () => Effect.sync(onChange)),
        forkEach(changes, () => Effect.sync(onChange)),
        forkEach(
          lookupService.changes.pipe(
            Stream.map((value) => value.status),
            Stream.changes,
          ),
          () => Effect.sync(onChange),
        ),
      ]).pipe(Scope.provide(observationScope));
      yield* Scope.provide(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            disposed = true;
          }),
        ),
        observationScope,
      );
      onChange();
      return () => {
        disposed = true;
        bridge.runAndForget(Scope.close(observationScope, Exit.void));
      };
    });

    /**
     * The reverse observation as one read, for a caller that answers a single
     * question instead of following the index — the agent-facing CLI. It reports
     * whatever the index holds now, so {@link waitUntilSettled} is what a caller
     * that wants a complete answer runs first.
     */
    const getCitedBy = Effect.fn("CitationIndex.getCitedBy")(function* (
      indexedKey: string,
      answer?: CitationLookupAnswer,
    ) {
      const occurrences = yield* citationsByPath([
        "citekey",
        "wikilink",
        "annotation",
      ]);
      const lookup =
        answer ??
        (yield* lookupService.read({
          annotationKeys: annotationCitationKeys(),
          citekeys: [...occurrences.values()].flatMap((citations) =>
            citations.flatMap((occurrence) =>
              occurrence.kind === "citekey" ? [occurrence.raw] : [],
            ),
          ),
        }));
      return yield* citedBy(
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
    });

    /**
     * Wait until coverage and citation-key resolution both have settled once. A
     * failed resolution read counts as settled data rather than a stage that
     * resolves on its own.
     *
     * @returns `"timeout"` when the bounded wait expires, `"settled"` otherwise.
     */

    const settle = Effect.fn("CitationIndex.settle")(
      function* (timeoutMs: number) {
        if (timeoutMs <= 0) return "timeout" as const;
        yield* Effect.all([whenIndexed, lookupService.whenResolved], {
          concurrency: "unbounded",
        });
        while (pendingScans.size > 0) {
          yield* Fiber.awaitAll(
            [...pendingScans.values()].map((pending) => pending.fiber),
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
    );

    const capture = Effect.fn("CitationIndex.capture")(function* (
      timeoutMs: number,
    ) {
      const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
      for (;;) {
        const remaining = deadline - (yield* Clock.currentTimeMillis);
        if ((yield* settle(remaining)) === "timeout") return null;
        const files = yield* vault.getMarkdownFiles;
        const stale = files.filter(
          (file) => !covered(file) && !failedPaths.has(file.path),
        );
        if (stale.length === 0) {
          return {
            scans: new Map(
              files.flatMap((file) => {
                const scan = covered(file);
                return scan ? [[file.path, scan] as const] : [];
              }),
            ),
            syntaxes: syntaxes(),
            coverage: getCoverage(),
          };
        }
        const refreshed = yield* Effect.forEach(
          stale,
          (file) => coverFile(file),
          { concurrency: BACKFILL_CONCURRENCY },
        ).pipe(
          Effect.timeoutOption(deadline - (yield* Clock.currentTimeMillis)),
        );
        if (Option.isNone(refreshed)) return null;
      }
    });

    const readAnnotationUses = Effect.fn("CitationIndex.readAnnotationUses")(
      function* (key: string, timeoutMs: number) {
        const captured = yield* capture(timeoutMs);
        if (!captured)
          return { kind: "timeout", coverage: "indexing" } as const;
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
      },
    );

    const readReferences = Effect.fn("CitationIndex.readReferences")(function* (
      path: string,
      timeoutMs: number,
    ) {
      const captured = yield* capture(timeoutMs);
      if (!captured) return { kind: "timeout", coverage: "indexing" } as const;
      const file = yield* vault.getFileByPath(path);
      const scan = captured.scans.get(path) ?? null;
      const document =
        file?.extension === "md"
          ? yield* composeDocument(file, scan, captured)
          : null;
      return { kind: "ready", document } as const;
    });

    const readCitedBy = Effect.fn("CitationIndex.readCitedBy")(function* (
      selector: { key: string } | { citekey: string },
      timeoutMs: number,
    ) {
      const snapshot = yield* capture(timeoutMs);
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
      const local = new Map<CitationOccurrence, string | null>();
      for (const { path, occurrences } of captured)
        for (const occurrence of occurrences)
          if (occurrence.kind === "wikilink")
            local.set(
              occurrence,
              (yield* resolve(occurrence, path))?.indexedKey ?? null,
            );
      const lookup = yield* lookupService.read({
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
      });
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
      const joined = yield* joinSources([{ indexedKey: key, linkpath: null }]);
      if (joined.database === "ready" && !joined.presentKeys.has(key))
        return { kind: "missing", key } as const;
      const groups: CitedByGroup[] = [];
      const omitted = new Set<CitationSyntax>();
      for (const { path, occurrences } of captured) {
        const included: CitationOccurrence[] = [];
        for (const occurrence of occurrences) {
          const cites =
            occurrence.kind === "citekey"
              ? citekeyOccurrenceCites(lookup.resolve(occurrence.raw), key)
              : occurrence.kind === "annotation"
                ? lookup.parentOfAnnotation(occurrence.raw)?.indexedKey === key
                : local.get(occurrence) === key;
          if (!cites) continue;
          if (syntaxes[occurrence.kind] === "included")
            included.push(occurrence);
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
        omittedSyntaxes: (
          ["citekey", "wikilink", "annotation"] as const
        ).filter((syntax) => omitted.has(syntax)),
        item: {
          key,
          citekey,
          summary: joined.sources.get(key)?.summary ?? null,
        },
      } as const;
    });

    /**
     * Which Citation Syntaxes admit their occurrences into an answer, for a
     * caller that declares the constraint beside its facts — the agent-facing
     * CLI. Follows the same source choices {@link admitted} applies to the
     * document set and Cited By.
     */
    function syntaxes(): CitationSyntaxes {
      return {
        citekey: includePandocCitations ? "included" : "excluded",
        wikilink: includeWikilinkCitations ? "included" : "excluded",
        annotation: includeAnnotationCitations ? "included" : "excluded",
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
    const documentOmittedSyntaxes = Effect.fn(
      "CitationIndex.documentOmittedSyntaxes",
    )(function* (file: TFile) {
      const scan = yield* coverFile(file);
      return yield* omittedDocument(scan, file.path, syntaxes());
    });

    const omittedDocument = Effect.fn("CitationIndex.omittedDocument")(
      function* (
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
      ) {
        const omitted: CitationSyntax[] = [];
        if (syntaxes.citekey === "excluded" && scan?.citekeys.length)
          omitted.push("citekey");
        if (
          syntaxes.wikilink === "excluded" &&
          (yield* Effect.forEach(
            [
              ...(scan?.wikilinks ?? []),
              ...(scan?.malformedWikilinks.map(
                ({ occurrence }) => occurrence,
              ) ?? []),
            ],
            (occurrence) => resolve(occurrence, path),
          )).some((note) => note !== null)
        )
          omitted.push("wikilink");
        if (
          syntaxes.annotation === "excluded" &&
          (scan?.annotations.some(({ form }) => form === "citation") ||
            scan?.malformedAnnotationCitations.length)
        )
          omitted.push("annotation");
        return omitted;
      },
    );

    /**
     * The admitted Citation Occurrences of every covered document, by path —
     * the Document Citation Set membership {@link admitted} gates, read
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
    const citationsByPath = Effect.fn("CitationIndex.citationsByPath")(
      function* (
        syntaxes: readonly CitationSyntax[],
      ): Effect.fn.Return<ReadonlyMap<string, readonly CitationOccurrence[]>> {
        const wantCitekeys = syntaxes.includes("citekey");
        const wantWikilinks = syntaxes.includes("wikilink");
        const wantAnnotations = syntaxes.includes("annotation");
        const byPath = new Map<string, readonly CitationOccurrence[]>();
        for (const file of yield* vault.getMarkdownFiles) {
          const selected = admitted(covered(file));
          const citekeys = wantCitekeys ? selected.citekeys : [];
          const occurrences = [
            ...citekeys,
            ...(wantWikilinks ? selected.wikilinks.occurrences : []),
            ...(wantAnnotations ? selected.annotations : []),
          ];
          if (occurrences.length > 0) byPath.set(file.path, occurrences);
        }
        return byPath;
      },
    );

    /**
     * Discards every stored scan and rebuilds from the vault — the recovery hatch
     * for an index that disagrees with the vault, over data the vault can always
     * produce again. Returns once the store is empty; the rebuild runs on from
     * there, and {@link whenIndexed} is what waits for it.
     */
    const reset = Effect.fn("CitationIndex.reset")(function* () {
      if (stopped) return;
      activeBuildNumber += 1;
      const covered = [...scans.keys()];
      yield* log("debug", "Citation index reset", { covered: covered.length });
      scans.clear();
      filesByCitekey.clear();
      annotationsByKey.clear();
      yield* Fiber.interruptAll(
        [...pendingScans.values()].map((pending) => pending.fiber),
      );
      pendingScans.clear();
      generations.clear();
      failedPaths.clear();
      backfilled = false;
      backfillFailed = false;
      yield* emit("cited-by-invalidated");
      if (store)
        yield* Effect.tryPromise(() => store!.clear()).pipe(
          Effect.catch((error) =>
            log("warn", "Failed to clear citation scans", { error }),
          ),
        );
      for (const path of covered) yield* emit("changed", path);
      yield* startBackfill();
    });

    /** Readiness settles even on a failed pass, so no consumer waits forever. */
    const runBackfill = Effect.fn("CitationIndex.runBackfill")(function* () {
      const activeBuild = activeBuildNumber;
      if (backfillBuild === activeBuild) return;
      backfillBuild = activeBuild;
      yield* log("debug", "Citation index backfill started", {
        build: activeBuild,
      });
      yield* backfill(activeBuild).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.gen(function* () {
            yield* log("error", "Citation index backfill failed", {
              error: cause,
            });
            if (!stale(activeBuild)) backfillFailed = true;
          });
        }),
      );
      if (stopped || activeBuild !== activeBuildNumber) return;
      yield* log("debug", "Citation index backfilled", { count: scans.size });
      backfilled = true;
      yield* emit("backfilled");
    });

    const backfill = Effect.fn("CitationIndex.backfill")(function* (
      build: number,
    ) {
      yield* Effect.forEach(
        yield* vault.getMarkdownFiles,
        (file) =>
          Effect.gen(function* () {
            if (stale(build)) return;
            yield* coverFile(file, true, build).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  if (stale(build)) return;
                  yield* setFailed(file.path, true);
                  yield* log("warn", "Citation backfill could not parse note", {
                    path: file.path,
                    error,
                  });
                }),
              ),
            );
          }),
        { concurrency: BACKFILL_CONCURRENCY, discard: true },
      );
      if (stale(build)) return;
      const present = new Set(
        (yield* vault.getMarkdownFiles).map((file) => file.path),
      );
      for (const path of scans.keys().toArray()) {
        if (!present.has(path)) yield* drop(path);
      }
    });

    /** Whether a build other than `build` has taken over. */
    function stale(build: number): boolean {
      return stopped || build !== activeBuildNumber;
    }

    // Runs per scanned file on the metadata intake and backfill hot path.
    const scan = Effect.fnUntraced(function* (file: TFile, body: string) {
      const { path } = file;
      const { mtime, size } = file.stat;
      const generation = ++nextGeneration;
      const activeBuild = activeBuildNumber;
      const previous = pendingScans.get(path);
      generations.set(path, generation);
      if (previous) yield* Fiber.interrupt(previous.fiber);
      const pending: {
        path: string;
        generation: number;
        fiber: Fiber.Fiber<FileScan | null, ParseFailed | ParseWorkerDied>;
      } = {
        path,
        generation,
        fiber: yield* Effect.forkIn(
          Effect.gen(function* () {
            const {
              record,
              path: replyPath,
              generation: replyGeneration,
            } = yield* parser.parse({ path, generation, text: body });
            const currentPath = pending.path;
            if (
              stale(activeBuild) ||
              generations.get(currentPath) !== generation ||
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
            const prev = scans.get(currentPath);
            const same = scanContentEqual(prev, scan);
            if (
              same &&
              prev?.mtime === mtime &&
              prev.size === size &&
              prev.scannerRevision === SCANNER_REVISION
            ) {
              yield* setFailed(currentPath, false);
              return prev;
            }
            setScan(currentPath, scan);
            yield* persist({ path: currentPath, ...scan });
            yield* setFailed(currentPath, false);
            if (!same) yield* emit("changed", currentPath);
            return scan;
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* setFailed(pending.path, true);
                const retained = scans.get(pending.path);
                if (retained) {
                  yield* log(
                    "warn",
                    "Citation parse failed; retaining saved scan",
                    { path: pending.path, error },
                  );
                  return retained;
                }
                return yield* error;
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (pendingScans.get(pending.path) === pending)
                  pendingScans.delete(pending.path);
              }),
            ),
          ),
          scope,
        ),
      };
      pendingScans.set(path, pending);
      return yield* Fiber.join(pending.fiber).pipe(
        Effect.catchCauseIf(
          (cause) => Cause.hasInterruptsOnly(cause),
          () => Effect.succeed(null),
        ),
      );
    });

    function getCoverage(): CitationCoverage {
      if (!backfilled) return "indexing";
      return backfillFailed || failedPaths.size > 0 ? "degraded" : "complete";
    }

    // Runs per scanned file on the metadata intake and backfill hot path.
    const setFailed = Effect.fnUntraced(function* (
      path: string,
      failed: boolean,
    ) {
      const coverage = getCoverage();
      if (failed) failedPaths.add(path);
      else failedPaths.delete(path);
      if (getCoverage() !== coverage) yield* emit("cited-by-invalidated");
    });

    function covered(file: TFile): FileScan | null {
      const scan = scans.get(file.path);
      if (!scan) return null;
      const { mtime, size } = file.stat;
      return (scan.mtime === mtime && scan.size === size) ||
        pendingScans.has(file.path) ||
        failedPaths.has(file.path)
        ? scan
        : null;
    }

    // Runs per scanned file on the metadata intake and backfill hot path.
    const coverFile = Effect.fnUntraced(function* (
      file: TFile,
      fresh = false,
      build = activeBuildNumber,
    ): Effect.fn.Return<
      FileScan | null,
      VaultError | ParseFailed | ParseWorkerDied
    > {
      while (!stale(build)) {
        if (!(yield* vault.getFileByPath(file.path))) return null;
        const known = covered(file);
        // A grammar update keeps the last scan available while its replacement runs.
        if (!fresh && known && known.scannerRevision !== SCANNER_REVISION)
          return known;
        const pending = pendingScans.get(file.path);
        if (pending) {
          yield* Fiber.join(pending.fiber).pipe(
            Effect.catchCauseIf(
              (cause) => Cause.hasInterruptsOnly(cause),
              () => Effect.void,
            ),
          );
          continue;
        }
        if (failedPaths.has(file.path)) return known;
        if (known && (!fresh || known.scannerRevision === SCANNER_REVISION))
          return known;
        if (!(yield* vault.getFileByPath(file.path))) return null;
        const path = file.path;
        const generation = generations.get(path);
        const { mtime, size } = file.stat;
        const body = yield* vault.cachedRead(file);
        if (stale(build)) return null;
        if (
          file.path !== path ||
          generations.get(path) !== generation ||
          file.stat.mtime !== mtime ||
          file.stat.size !== size
        )
          continue;
        if (!(yield* vault.getFileByPath(path))) return null;
        yield* scan(file, body);
      }
      return null;
    });

    const drop = Effect.fn("CitationIndex.drop")(function* (path: string) {
      restoreInvalidated?.add(path);
      yield* setFailed(path, false);
      generations.set(path, ++nextGeneration);
      const replaced = pendingScans.get(path);
      if (replaced) yield* Fiber.interrupt(replaced.fiber);
      pendingScans.delete(path);
      const scan = scans.get(path);
      if (!scan) return;
      removeScan(path);
      yield* forget(path);
      if (!scanContentEqual(undefined, scan)) yield* emit("changed", path);
    });

    const move = Effect.fn("CitationIndex.move")(function* (
      oldPath: string,
      path: string,
    ) {
      if (failedPaths.delete(oldPath)) failedPaths.add(path);
      restoreInvalidated?.add(oldPath);
      restoreInvalidated?.add(path);
      generations.set(oldPath, ++nextGeneration);
      const pending = pendingScans.get(oldPath);
      if (pending) {
        pendingScans.delete(oldPath);
        const replaced = pendingScans.get(path);
        if (replaced) yield* Fiber.interrupt(replaced.fiber);
        pending.path = path;
        pendingScans.set(path, pending);
        generations.set(path, pending.generation);
      }
      const scan = scans.get(oldPath);
      if (!scan) return;
      removeScan(oldPath);
      setScan(path, scan);
      yield* forget(oldPath);
      yield* persist({ path, ...scan });
      if (!scanContentEqual(undefined, scan)) yield* emit("changed", path);
    });

    /**
     * Writes are per file and never awaited: the store is derived data, so a
     * failed write costs one rescan on the next launch. Every caller runs on the
     * current build, which is what keeps a superseded one out of the store.
     */
    const persist = Effect.fnUntraced(function* (record: CitekeyRecord) {
      if (stopped || !store) return;
      const target = store;
      yield* Effect.tryPromise(() => target.put(record)).pipe(
        Effect.catch((error) =>
          log("error", "Failed to persist a citation scan", {
            path: record.path,
            error,
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      );
    });

    const forget = Effect.fnUntraced(function* (path: string) {
      if (stopped || !store) return;
      const target = store;
      yield* Effect.tryPromise(() => target.drop(path)).pipe(
        Effect.catch((error) =>
          log("error", "Failed to drop a citation scan", { path, error }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      );
    });

    function admitted(scan: CitationRecord | null, choices = syntaxes()) {
      return {
        annotations:
          choices.annotation === "included" ? annotationCitations(scan) : [],
        malformedAnnotations:
          choices.annotation === "included"
            ? (scan?.malformedAnnotationCitations ?? [])
            : [],
        citekeys: choices.citekey === "included" ? (scan?.citekeys ?? []) : [],
        wikilinks: {
          occurrences:
            choices.wikilink === "included" ? (scan?.wikilinks ?? []) : [],
          malformed:
            choices.wikilink === "included"
              ? (scan?.malformedWikilinks ?? [])
              : [],
        },
      };
    }

    function citationKeys(): string[] {
      return [...filesByCitekey.keys()];
    }

    function annotationCitationKeys(): string[] {
      return [...annotationsByKey].flatMap(([key, paths]) =>
        [...paths.values()].some((occurrences) =>
          occurrences.some(({ form }) => form === "citation"),
        )
          ? [key]
          : [],
      );
    }

    /** Synchronous stored facts, in path order and then document order. */
    function getAnnotationUses(indexedKey: string): readonly AnnotationUse[] {
      const paths = annotationsByKey.get(indexedKey);
      if (!paths) return [];
      return [...paths]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([path, occurrences]) =>
          occurrences.map((occurrence) => ({ path, occurrence })),
        );
    }

    function setScan(path: string, scan: FileScan): void {
      removeScan(path);
      scans.set(path, scan);
      for (const { raw } of scan.citekeys) {
        const paths = filesByCitekey.get(raw) ?? new Set<string>();
        paths.add(path);
        filesByCitekey.set(raw, paths);
      }
      for (const occurrence of scan.annotations) {
        const paths =
          annotationsByKey.get(occurrence.indexedKey) ??
          new Map<string, AnnotationOccurrence[]>();
        const occurrences = paths.get(path) ?? [];
        occurrences.push(occurrence);
        paths.set(path, occurrences);
        annotationsByKey.set(occurrence.indexedKey, paths);
      }
    }

    function removeScan(path: string): void {
      const scan = scans.get(path);
      if (!scan) return;
      scans.delete(path);
      for (const { raw } of scan.citekeys) {
        const paths = filesByCitekey.get(raw);
        paths?.delete(path);
        if (paths?.size === 0) filesByCitekey.delete(raw);
      }
      for (const { indexedKey } of scan.annotations) {
        const paths = annotationsByKey.get(indexedKey);
        paths?.delete(path);
        if (paths?.size === 0) annotationsByKey.delete(indexedKey);
      }
    }

    const citedBy = Effect.fn("CitationIndex.citedBy")(function* (
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
    ) {
      const groups: CitedByGroup[] = [];
      const files = (yield* vault.getMarkdownFiles)
        .filter(includeNote)
        .sort((a, b) => comparePaths(a.path, b.path));
      for (const file of files) {
        const occurrences: CitationOccurrence[] = [];
        for (const occurrence of byPath.get(file.path) ?? []) {
          const cites =
            occurrence.kind === "citekey"
              ? citekeyOccurrenceCites(resolve(occurrence.raw), indexedKey)
              : occurrence.kind === "annotation"
                ? parentOfAnnotation(occurrence.raw) === indexedKey
                : (yield* indexedKeyOf(occurrence.raw, file.path)) ===
                  indexedKey;
          if (cites) occurrences.push(occurrence);
        }
        occurrences.sort(compareOccurrences);
        if (occurrences.length > 0) {
          groups.push({ path: file.path, occurrences });
        }
      }
      const status = (yield* lookupService.current).status;
      return {
        groups,
        coverage: getCoverage(),
        resolution: status === "pending" ? null : status,
      };
    });

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
    const citedByOmittedSyntaxes = Effect.fn(
      "CitationIndex.citedByOmittedSyntaxes",
    )(function* (indexedKey: string, answer?: CitationLookupAnswer) {
      const files = yield* vault.getMarkdownFiles;
      const omitted: CitationSyntax[] = [];
      const citekeys = files.flatMap((file) => covered(file)?.citekeys ?? []);
      const lookup =
        answer ??
        (yield* lookupService.read({
          citekeys: citekeys.map((occurrence) => occurrence.raw),
          annotationKeys: annotationCitationKeys(),
        }));
      if (!includePandocCitations) {
        const held = citekeys.some((occurrence) =>
          citekeyOccurrenceCites(lookup.resolve(occurrence.raw), indexedKey),
        );
        if (held) omitted.push("citekey");
      }
      if (!includeWikilinkCitations) {
        let held = false;
        for (const file of files) {
          for (const occurrence of covered(file)?.wikilinks ?? []) {
            if ((yield* indexedKeyOf(occurrence.raw, file.path)) === indexedKey)
              held = true;
          }
        }
        if (held) omitted.push("wikilink");
      }
      if (
        !includeAnnotationCitations &&
        annotationCitationKeys().some(
          (key) => lookup.parentOfAnnotation(key)?.indexedKey === indexedKey,
        )
      )
        omitted.push("annotation");
      return omitted;
    });

    /**
     * Whether a literal-citekey Citation Occurrence cites `indexedKey`.
     *
     * An Ambiguous Citation Key names every one of its candidates here, so one
     * occurrence answers for each of them: the reverse observation reports a
     * possible citation relationship rather than omitting it. The forward
     * direction stays untouched — the occurrence is still one Citation of the
     * key itself, so no candidate gains a Citation record of its own.
     */
    function citekeyOccurrenceCites(
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

    const resolve = Effect.fn("CitationIndex.resolve")(function* (
      occurrence: CitationOccurrence,
      sourcePath: string,
      lookup?: CitationLookupAnswer,
    ) {
      if (occurrence.kind === "wikilink") {
        const indexedKey = yield* indexedKeyOf(occurrence.raw, sourcePath);
        return indexedKey ? { indexedKey, linkpath: occurrence.raw } : null;
      }
      if (occurrence.kind === "annotation") {
        const parent = lookup!.parentOfAnnotation(occurrence.raw);
        if (!parent) return null;
        const [note] = yield* noteIndex.getNotesByItemKey(parent.indexedKey);
        return { indexedKey: parent.indexedKey, linkpath: note?.path ?? null };
      }
      // An Ambiguous Citation Key keeps its own identity here: it adopts no
      // candidate's Indexed Key, so it stays a Citation of the key itself and
      // contributes no CSL work.
      const resolved = lookup!.resolve(occurrence.raw);
      const item = resolved.kind === "unique" ? resolved.item : null;
      if (!item) return null;
      const [note] = yield* noteIndex.getNotesByItemKey(item.indexedKey);
      return { indexedKey: item.indexedKey, linkpath: note?.path ?? null };
    });

    /** Apply citation settings without stopping the internal scan or resolution. */
    const applySettings = Effect.fn("CitationIndex.applySettings")(function* (
      settings: Readonly<Settings>,
    ) {
      const nextPandoc = settings["citation.pandoc-citations"];
      const nextWikilinks = settings["citation.wikilink-citations"];
      const nextAnnotations = settings["citation.annotation-citations"];
      const membershipChanged =
        nextPandoc !== includePandocCitations ||
        nextWikilinks !== includeWikilinkCitations ||
        nextAnnotations !== includeAnnotationCitations;
      if (!membershipChanged) return;
      includePandocCitations = nextPandoc;
      includeWikilinkCitations = nextWikilinks;
      includeAnnotationCitations = nextAnnotations;
      yield* log("debug", "Citation source membership changed", {
        pandocCitations: nextPandoc,
        wikilinkCitations: nextWikilinks,
        annotationCitations: nextAnnotations,
      });
      yield* emit("membership-changed");
    });

    const startBackfill = Effect.fnUntraced(function* () {
      if (!stopped)
        yield* runBackfill().pipe(
          recover,
          Effect.forkIn(scope, { startImmediately: true }),
        );
    });
    // Stop before the child scope closes its store, listeners, and scan fibers.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stopped = true;
        yield* Scope.close(scope, Exit.void);
        yield* publishState();
      }),
    );
    const intake = yield* obsidianEvents<{
      metadata: [MetadataEvent];
      rename: [Extract<VaultEvent, { _tag: "rename" }>];
      layoutReady: [];
    }>().pipe(Scope.provide(scope));
    yield* intake
      .consume((event) =>
        Effect.gen(function* () {
          switch (event.type) {
            case "metadata": {
              const [change] = event.args;
              if (change._tag === "changed") {
                if (!isMarkdownFile(change.file)) return;
                yield* scan(change.file, change.data).pipe(
                  recover,
                  Effect.forkIn(scope, { startImmediately: true }),
                );
              } else if (change._tag === "deleted")
                yield* drop(change.file.path);
              yield* emit("cited-by-invalidated");
              break;
            }
            case "rename": {
              const [{ file, oldPath }] = event.args;
              yield* move(oldPath, file.path);
              yield* emit("cited-by-invalidated");
              break;
            }
            case "layoutReady":
              yield* startBackfill();
              break;
          }
        }),
      )
      .pipe(Effect.forkIn(scope, { startImmediately: true }));
    // The metadata cache's events join the vault's in one ordered intake:
    // forkEach hands each over inside Obsidian's callback.
    yield* forkEach(metadata.changes, intake.callback("metadata")).pipe(
      Scope.provide(scope),
    );
    yield* forkEach(
      filterTag(vault.changes, "rename"),
      intake.callback("rename"),
    ).pipe(Scope.provide(scope));
    yield* forkEach(settings.changes, applySettings).pipe(Scope.provide(scope));
    // IndexedDB can stall; startup waits the shared bound and the open goes on.
    // Scans and drops made before a late open never reached the store, so the
    // restore writes them through.
    const restore = Effect.gen(function* () {
      const opened = yield* Effect.acquireRelease(
        Effect.tryPromise(() => openStore(appId)),
        (opened) => Effect.try(() => opened[Symbol.dispose]()).pipe(recover),
      ).pipe(Scope.provide(scope));
      store = opened;
      const loaded = yield* Effect.tryPromise(() => opened.load());
      const restoredPaths = new Set<string>();
      for (const { path, ...scan } of loaded) {
        if (!scans.has(path) && !restoreInvalidated?.has(path)) {
          setScan(path, scan);
          restoredPaths.add(path);
        }
      }
      for (const [path, scan] of scans)
        if (!restoredPaths.has(path)) yield* persist({ path, ...scan });
      for (const path of restoreInvalidated ?? [])
        if (!scans.has(path)) yield* forget(path);
      yield* log("debug", "Citation index store loaded", {
        count: loaded.length,
        restored: restoredPaths.size,
      });
    }).pipe(
      recover,
      Effect.ensuring(
        Effect.sync(() => {
          restoreInvalidated = null;
        }),
      ),
    );
    yield* startupBarrier(
      restore,
      log("warn", "Citation index store is still opening", {}),
    ).pipe(Scope.provide(scope));
    yield* workspace.layoutReady.pipe(
      Effect.andThen(Effect.sync(() => intake.callback("layoutReady")())),
      Effect.forkIn(scope, { startImmediately: true }),
    );
    return {
      current,
      changes,
      events,
      observeCitedBy,
      /**
       * The Cited By of the Item `indexedKey` as `observeCitedBy` publishes
       * it; interrupting the Stream stops the observer.
       */
      citedBy: (indexedKey: string): Stream.Stream<CitedBySnapshot> =>
        Stream.callback<CitedBySnapshot>((queue) =>
          Effect.gen(function* () {
            const stop = yield* observeCitedBy(indexedKey, (snapshot) => {
              Queue.offerUnsafe(queue, snapshot);
            });
            yield* Effect.addFinalizer(() => Effect.sync(stop));
          }),
        ),
      readAnnotationUses,
      readReferences,
      readCitedBy,
      waitUntilSettled: settle,
      syntaxes: Effect.fn("CitationIndex.syntaxes")(function* (
        ...args: Parameters<typeof syntaxes>
      ) {
        return yield* Effect.sync(() => syntaxes(...args));
      }),
      citationKeys: Effect.fn("CitationIndex.citationKeys")(function* (
        ...args: Parameters<typeof citationKeys>
      ) {
        return yield* Effect.sync(() => citationKeys(...args));
      }),
      annotationCitationKeys: Effect.fn("CitationIndex.annotationCitationKeys")(
        function* (...args: Parameters<typeof annotationCitationKeys>) {
          return yield* Effect.sync(() => annotationCitationKeys(...args));
        },
      ),
      getAnnotationUses: Effect.fn("CitationIndex.getAnnotationUses")(
        function* (...args: Parameters<typeof getAnnotationUses>) {
          return yield* Effect.sync(() => getAnnotationUses(...args));
        },
      ),
      citationsByPath,
      getFileScan,
      getDocumentCitationSet,
      getParsedNote: Effect.fn("CitationIndex.getParsedNote")(parsedNote),
      getParsedDocument,
      whenIndexed,
      getCitedBy,
      documentOmittedSyntaxes,
      citedByOmittedSyntaxes,
      // The caller can leave; the layer waits for the reset transaction to finish.
      reset: Effect.gen(function* () {
        const write = yield* reset().pipe(
          Effect.uninterruptible,
          Effect.forkIn(scope, { startImmediately: true }),
        );
        yield* Fiber.join(write);
      }).pipe(Effect.withSpan("CitationIndex.reset")),
    };
  }).pipe(withLogCategory("citation-index"));
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
