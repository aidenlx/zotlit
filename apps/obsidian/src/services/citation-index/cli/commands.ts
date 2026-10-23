// The citation commands and their response boundaries.
import type { CliData } from "obsidian";

import type { CliCommandHandler } from "@/lib/cli-command";
import { catchRejection } from "@/lib/cli-params";
import type { CliRejection } from "@/lib/cli-params";
import { Data, Effect } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import type {
  CitationLookupAnswer,
  CitationLookupRequest,
} from "@/services/citation-index/lookup";
import type {
  AnnotationUse,
  CitationCoverage,
  Citation,
  CitationKeyResolution,
  CitationSettleOutcome,
  CitationSyntax,
  CitationSyntaxes,
  CitedBySnapshot,
  CitekeyResolution,
  DatabaseReadability,
  DocumentCitationError,
  ReferenceSource,
} from "@/services/citation-index/service";

import {
  ambiguousCitekeyDiagnostic,
  citekeyNotFoundDiagnostic,
  diagnostic,
  envelope,
  fileNotFoundDiagnostic,
  keyNotFoundDiagnostic,
  notSettledDiagnostic,
  rejectionDiagnostic,
  reportCandidates,
  reportAnnotationUses,
  reportGroups,
  reportOccurrences,
} from "./envelope";
import type {
  CitationsCommand,
  CitationsIdentity,
  CitedItem,
  Diagnostic,
  ReferenceEntry,
} from "./envelope";
import { renderCitationsGuide } from "./guide";
import {
  parseAnnotationUsesRequest,
  parseCitedByRequest,
  parseGuideRequest,
  parseReferencesRequest,
  targetMismatch,
} from "./request";
import type { CitedBySelector } from "./request";

export type { CitationsIdentity } from "./envelope";

export const CITED_BY_COMMAND =
  "zotlit:cited-by" as const satisfies CitationsCommand;

export const REFERENCES_COMMAND =
  "zotlit:references" as const satisfies CitationsCommand;

export const ANNOTATION_USES_COMMAND =
  "zotlit:annotation-uses" as const satisfies CitationsCommand;

export const CITATIONS_GUIDE_COMMAND =
  "zotlit:citations-guide" as const satisfies CitationsCommand;

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/** Whether the connected Zotero source holds an Item for a well-formed Zotero
 *  key. `"unreadable"` is a degraded database, which the payload reports as a
 *  resolution state rather than as a missing Item. */
type ItemPresence = "present" | "absent" | "unreadable";

/** What one read of the connected Zotero source answers about an Item: whether
 *  it holds one, and the summary its fields render to. */
export interface ItemLookup {
  presence: ItemPresence;
  /** `Creators (Year): Title` from the shared item-summary rendering, or
   *  `null` when the read renders no summary for the Item. */
  summary: string | null;
}

/** One document's Citations joined with the cited Items the database holds. */
export interface DocumentReferences {
  /** The Document Citation Set, in first-occurrence order. */
  citations: readonly Citation[];
  errors: readonly DocumentCitationError[];
  lookup: CitationLookupAnswer;
  /** The source-join by Indexed Key; an Item the database no longer holds is absent. */
  sources: ReadonlyMap<string, ReferenceSource>;
  /** Whether the join read the database at all, which is what says whether an
   *  absent Item is one the source no longer holds. */
  database: DatabaseReadability;
}

interface CitationsCliDeps {
  getIdentity: () => CitationsIdentity | Promise<CitationsIdentity>;
  /** @default 5000 */
  settleTimeoutMs?: number;
  index: {
    getAnnotationUses: (indexedKey: string) => readonly AnnotationUse[];
    coverage: () => CitationCoverage;
    waitUntilSettled: (timeoutMs: number) => Promise<CitationSettleOutcome>;
    /** What a citation key names through the Citekey Resolution Snapshot: no
     *  Item, exactly one, or the candidates that make it Ambiguous. */
    readLookup: (
      request: CitationLookupRequest,
    ) => Promise<CitationLookupAnswer>;
    citationKeys: () => readonly string[];
    annotationCitationKeys: () => readonly string[];
    getCitedBy: (
      indexedKey: string,
      lookup: CitationLookupAnswer,
    ) => Promise<CitedBySnapshot>;
    /** How well citation keys resolve now; a references answer reports it, the
     *  cited-by snapshot carries its own. */
    resolution: () => CitationKeyResolution;
    /** Which Citation Syntaxes admit occurrences into an answer now; both
     *  commands report it. */
    syntaxes: () => CitationSyntaxes;
    /** The excluded Citation Syntaxes that held occurrences in one document —
     *  the fact every references answer carries. */
    documentOmittedSyntaxes: (
      path: string,
    ) => Promise<readonly CitationSyntax[]>;
    /** The excluded Citation Syntaxes that held occurrences of one Item — the
     *  fact every cited-by answer carries. */
    citedByOmittedSyntaxes: (
      indexedKey: string,
      lookup: CitationLookupAnswer,
    ) => Promise<readonly CitationSyntax[]>;
  };
  /** Never fails: a source that cannot answer reports `"unreadable"`. */
  lookupItem: (indexedKey: string) => Effect.Effect<ItemLookup>;
  /**
   * @returns the document's references, or `null` when the vault holds no
   *   Markdown note at the path.
   */
  readDocument: (path: string) => Promise<DocumentReferences | null>;
}

export type CitationsCliHandlers = Record<
  | typeof CITED_BY_COMMAND
  | typeof REFERENCES_COMMAND
  | typeof ANNOTATION_USES_COMMAND
  | typeof CITATIONS_GUIDE_COMMAND,
  CliCommandHandler
>;

/** The command may read data, or it has already answered why it may not. */
type Admission =
  | { kind: "admitted"; echoed: EchoedFacts }
  | { kind: "rejected"; response: string };

interface EchoedFacts {
  request: object;
  identity: CitationsIdentity;
}

/** A read of the index or the source that failed with `cause`, which the
 *  command answers with an INDEX_NOT_READY diagnostic. */
class IndexUnavailable extends Data.TaggedError("IndexUnavailable")<{
  readonly cause: unknown;
}> {}

/** One read the command answers INDEX_NOT_READY for when it fails. */
const read = <A>(f: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) => new IndexUnavailable({ cause }),
  });

export function createCitationsCliHandlers(
  deps: CitationsCliDeps,
): CitationsCliHandlers {
  const settleTimeoutMs = deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  /**
   * The gate every citation command passes before it reads anything: the
   * asserted Zotero source, so a call aimed at another library costs no data
   * load at all, then the bounded wait out of the transitional index states.
   */
  const admit = Effect.fn("CitationsCli.admit")(function* (
    command: CitationsCommand,
    params: CliData,
    request: object,
  ) {
    const identity = yield* Effect.promise(async () => deps.getIdentity());
    const echoed = { request, identity };
    const reject = (fault: Diagnostic): Admission => ({
      kind: "rejected",
      response: envelope(command, { ok: false, ...echoed, diagnostic: fault }),
    });

    const mismatch = targetMismatch(params, identity);
    if (mismatch) return reject(mismatch);
    const outcome = yield* Effect.promise(() =>
      deps.index.waitUntilSettled(settleTimeoutMs),
    );
    if (outcome !== "settled")
      return reject(notSettledDiagnostic(settleTimeoutMs));
    return { kind: "admitted" as const, echoed };
  });

  return {
    [ANNOTATION_USES_COMMAND]: Effect.fn("CitationsCli.annotationUses")(
      function* (params: CliData) {
        const request = yield* parseAnnotationUsesRequest(params);
        const admission = yield* admit(
          ANNOTATION_USES_COMMAND,
          params,
          request,
        );
        if (admission.kind === "rejected") return admission.response;
        return envelope(ANNOTATION_USES_COMMAND, {
          ok: true,
          ...admission.echoed,
          groups: reportAnnotationUses(
            deps.index.getAnnotationUses(request.key),
          ),
          coverage: deps.index.coverage(),
        });
      },
      answerRejection(ANNOTATION_USES_COMMAND),
    ),
    [CITED_BY_COMMAND]: Effect.fn("CitationsCli.citedBy")(function* (
      params: CliData,
    ) {
      const request = yield* parseCitedByRequest(params);

      const admission = yield* admit(CITED_BY_COMMAND, params, request);
      if (admission.kind === "rejected") return admission.response;
      const { echoed } = admission;

      return yield* Effect.gen(function* () {
        const syntaxes = deps.index.syntaxes();
        const lookup = yield* read(() =>
          deps.index.readLookup({
            citekeys: [
              ...deps.index.citationKeys(),
              ...("citekey" in request ? [request.citekey] : []),
            ],
            indexedKeys: "key" in request ? [request.key] : [],
            annotationKeys: deps.index.annotationCitationKeys(),
          }),
        );
        const selected = yield* resolveItem(deps, request, lookup);
        if (selected.kind === "fault") {
          return envelope(CITED_BY_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: selected.diagnostic,
          });
        }

        const { item } = selected;
        const snapshot = yield* read(() =>
          deps.index.getCitedBy(item.key, lookup),
        );
        const groups = reportGroups(snapshot.groups);
        const omittedSyntaxes = yield* read(() =>
          deps.index.citedByOmittedSyntaxes(item.key, lookup),
        );
        return envelope(CITED_BY_COMMAND, {
          ok: true,
          ...echoed,
          item,
          groups,
          omittedSyntaxes,
          coverage: snapshot.coverage,
          resolution: snapshot.resolution,
          syntaxes,
        });
      }).pipe(answerUnavailable(CITED_BY_COMMAND, echoed));
    }, answerRejection(CITED_BY_COMMAND)),

    [REFERENCES_COMMAND]: Effect.fn("CitationsCli.references")(function* (
      params: CliData,
    ) {
      const request = yield* parseReferencesRequest(params);

      const admission = yield* admit(REFERENCES_COMMAND, params, request);
      if (admission.kind === "rejected") return admission.response;
      const { echoed } = admission;

      return yield* Effect.gen(function* () {
        const { file } = request;
        const references = yield* read(() => deps.readDocument(file));
        if (references === null) {
          return envelope(REFERENCES_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: fileNotFoundDiagnostic(file),
          });
        }

        const entries = referenceEntries(references, (citekey) =>
          references.lookup.resolve(citekey),
        );
        return envelope(REFERENCES_COMMAND, {
          ok: true,
          ...echoed,
          entries,
          omittedSyntaxes: yield* read(() =>
            deps.index.documentOmittedSyntaxes(file),
          ),
          database: references.database,
          resolution: deps.index.resolution(),
          syntaxes: deps.index.syntaxes(),
        });
      }).pipe(answerUnavailable(REFERENCES_COMMAND, echoed));
    }, answerRejection(REFERENCES_COMMAND)),

    /** Literal prose, no envelope: the page is the whole answer. */
    [CITATIONS_GUIDE_COMMAND]: (params: CliData) =>
      parseGuideRequest(params).pipe(
        Effect.map(() => renderCitationsGuide()),
        answerRejection(CITATIONS_GUIDE_COMMAND),
      ),
  };
}

/**
 * A failed read answers the command's INDEX_NOT_READY diagnostic, as does a
 * read that throws: a defect of the admitted reads, never an interruption.
 * Either is logged with what failed.
 */
const answerUnavailable =
  (command: CitationsCommand, echoed: EchoedFacts) =>
  <R>(effect: Effect.Effect<string, IndexUnavailable, R>) => {
    const answer = (error: unknown) =>
      Effect.logWarning("Cannot read the Citation Index").pipe(
        Effect.annotateLogs({ command, error }),
        withLogCategory("citation-index", "cli"),
        Effect.as(unavailable(command, echoed)),
      );
    return effect.pipe(
      Effect.catchTag("IndexUnavailable", ({ cause }) => answer(cause)),
      Effect.catchDefect(answer),
    );
  };

function unavailable(command: CitationsCommand, echoed: EchoedFacts): string {
  return envelope(command, {
    ok: false,
    ...echoed,
    diagnostic: diagnostic(
      "INDEX_NOT_READY",
      "The Citation Index cannot read the latest citation lookup. Refresh the Zotero source and run the command again.",
    ),
  });
}

/** A rejected request answers its diagnostic envelope. */
const answerRejection = (command: CitationsCommand) =>
  catchRejection((rejected) => invalidRequest(command, rejected));

function invalidRequest(
  command: CitationsCommand,
  request: CliRejection,
): string {
  return envelope(command, {
    ok: false,
    diagnostic: rejectionDiagnostic(request),
  });
}

/** The Item a selector named, or the diagnostic that says why it named none. */
type SelectedItem =
  | { kind: "selected"; item: CitedItem }
  | { kind: "fault"; diagnostic: Diagnostic };

/**
 * The Item a selector names, read once for both its presence and its summary,
 * or the fault that says why it names no one Item.
 */
const resolveItem = Effect.fn("CitationsCli.resolveItem")(function* (
  deps: CitationsCliDeps,
  selector: CitedBySelector,
  lookup: CitationLookupAnswer,
) {
  if ("citekey" in selector) {
    const { citekey } = selector;
    const resolved = lookup.resolve(citekey);
    if (resolved.kind === "missing") {
      return fault(citekeyNotFoundDiagnostic(citekey));
    }
    if (resolved.kind === "ambiguous") {
      return fault(
        ambiguousCitekeyDiagnostic(
          citekey,
          reportCandidates(resolved.candidates),
        ),
      );
    }
    const { indexedKey } = resolved.item;
    return selected({
      key: indexedKey,
      citekey,
      summary: (yield* deps.lookupItem(indexedKey)).summary,
    });
  }
  const { key } = selector;
  const { presence, summary } = yield* deps.lookupItem(key);
  if (presence === "absent") {
    return fault(keyNotFoundDiagnostic(key));
  }
  return selected({ key, citekey: lookup.citekeyOf(key), summary });
});

const fault = (diagnostic: Diagnostic): SelectedItem => ({
  kind: "fault",
  diagnostic,
});

const selected = (item: CitedItem): SelectedItem => ({
  kind: "selected",
  item,
});

/**
 * The document's reference list, in the five kinds a CLI answer distinguishes.
 *
 * A malformed entry names no work, so it sorts in by the one occurrence it
 * carries; every other entry keeps the Reference Number the index assigned it,
 * which leaves the whole list in first-occurrence order.
 *
 * @param resolveCitekey what a citekey names now, which is what tells an
 *   Ambiguous Citation Key from one that names no Item at all.
 */
function referenceEntries(
  { citations, errors, sources }: DocumentReferences,
  resolveCitekey: (citekey: string) => CitekeyResolution,
): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  for (const { indexedKey, refNumber, occurrences } of citations) {
    const reported = reportOccurrences(occurrences);
    if (indexedKey === null) {
      const first = occurrences[0]!;
      if (first.kind === "annotation") {
        entries.push({
          refNumber,
          kind: "unresolved",
          annotationKey: first.raw,
          occurrences: reported,
        });
        continue;
      }
      // Every remaining Citation naming no single Item is written as a citekey — a
      // wikilink that resolves to no Item is no Citation at all — so its raw
      // text names it. A key several items carry adopts none of them, which is
      // why it reaches this branch alongside a key no item carries.
      const citekey = occurrences[0]!.raw;
      const resolved = resolveCitekey(citekey);
      entries.push(
        resolved.kind === "ambiguous"
          ? {
              refNumber,
              kind: "ambiguous",
              citekey,
              candidates: reportCandidates(resolved.candidates),
              occurrences: reported,
            }
          : {
              refNumber,
              kind: "unresolved",
              citekey,
              occurrences: reported,
            },
      );
      continue;
    }
    const source = sources.get(indexedKey);
    entries.push(
      source
        ? {
            refNumber,
            kind: "resolved",
            key: indexedKey,
            citekey: source.citekey,
            summary: source.summary,
            linkpath: source.linkpath,
            occurrences: reported,
          }
        : {
            refNumber,
            kind: "missing",
            key: indexedKey,
            occurrences: reported,
          },
    );
  }
  for (const { occurrence } of errors) {
    entries.push({
      kind: "malformed",
      occurrences: reportOccurrences([occurrence]),
    });
  }
  return entries.sort(
    (left, right) =>
      left.occurrences[0]!.position.start.offset -
      right.occurrences[0]!.position.start.offset,
  );
}
