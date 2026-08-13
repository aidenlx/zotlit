// The citation commands and their response boundaries.

import type { CliData, CliHandler } from "obsidian";

import type {
  Citation,
  CitationKeyResolution,
  CitationSettleOutcome,
  CitationSyntaxes,
  CitedBySnapshot,
  DatabaseReadability,
  DocumentCitationError,
  ReferenceSource,
  SnapshotItem,
} from "@/services/citation-index/service";

import {
  citekeyNotFoundDiagnostic,
  diagnostic,
  envelope,
  fileNotFoundDiagnostic,
  keyNotFoundDiagnostic,
  notSettledDiagnostic,
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
  parseCitedByRequest,
  parseGuideRequest,
  parseReferencesRequest,
  targetMismatch,
} from "./request";
import type { CitedBySelector, ParsedRequest } from "./request";

export type { CitationsIdentity } from "./envelope";

export const CITED_BY_COMMAND =
  "zotlit:cited-by" as const satisfies CitationsCommand;

export const REFERENCES_COMMAND =
  "zotlit:references" as const satisfies CitationsCommand;

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
    waitUntilSettled: (timeoutMs: number) => Promise<CitationSettleOutcome>;
    /** The Item a citation key names, through the Citekey Resolution Snapshot. */
    resolveCitekey: (citekey: string) => SnapshotItem | null;
    citekeyOf: (indexedKey: string) => string | null;
    getCitedBy: (indexedKey: string) => CitedBySnapshot;
    /** How well citation keys resolve now; a references answer reports it, the
     *  cited-by snapshot carries its own. */
    resolution: () => CitationKeyResolution;
    /** Which Citation Syntaxes admit occurrences into an answer now; both
     *  commands report it. */
    syntaxes: () => CitationSyntaxes;
  };
  lookupItem: (indexedKey: string) => ItemLookup;
  /**
   * @returns the document's references, or `null` when the vault holds no
   *   Markdown note at the path.
   */
  readDocument: (path: string) => Promise<DocumentReferences | null>;
}

export type CitationsCliHandlers = Record<
  | typeof CITED_BY_COMMAND
  | typeof REFERENCES_COMMAND
  | typeof CITATIONS_GUIDE_COMMAND,
  CliHandler
>;

/** The command may read data, or it has already answered why it may not. */
type Admission =
  | { kind: "admitted"; echoed: EchoedFacts }
  | { kind: "rejected"; response: string };

interface EchoedFacts {
  request: object;
  identity: CitationsIdentity;
}

export function createCitationsCliHandlers(
  deps: CitationsCliDeps,
): CitationsCliHandlers {
  const settleTimeoutMs = deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  /**
   * The gate every citation command passes before it reads anything: the
   * asserted Zotero source, so a call aimed at another library costs no data
   * load at all, then the bounded wait out of the transitional index states.
   */
  const admit = async (
    command: CitationsCommand,
    params: CliData,
    request: object,
  ): Promise<Admission> => {
    const identity = await deps.getIdentity();
    const echoed = { request, identity };
    const reject = (fault: Diagnostic): Admission => ({
      kind: "rejected",
      response: envelope(command, { ok: false, ...echoed, diagnostic: fault }),
    });

    const mismatch = targetMismatch(params, identity);
    if (mismatch) return reject(mismatch);
    const outcome = await deps.index.waitUntilSettled(settleTimeoutMs);
    if (outcome !== "settled")
      return reject(notSettledDiagnostic(settleTimeoutMs));
    return { kind: "admitted", echoed };
  };

  return {
    [CITED_BY_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseCitedByRequest(params);
      if (request.kind === "invalid") {
        return invalidRequest(CITED_BY_COMMAND, request);
      }

      const admission = await admit(CITED_BY_COMMAND, params, request.value);
      if (admission.kind === "rejected") return admission.response;
      const { echoed } = admission;

      const item = resolveItem(deps, request.value);
      if (item === null) {
        return envelope(CITED_BY_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: selectorNotFound(request.value),
        });
      }

      const snapshot = deps.index.getCitedBy(item.key);
      return envelope(CITED_BY_COMMAND, {
        ok: true,
        ...echoed,
        item,
        groups: reportGroups(snapshot.groups),
        coverage: snapshot.coverage,
        resolution: snapshot.resolution,
        syntaxes: deps.index.syntaxes(),
      });
    },

    [REFERENCES_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseReferencesRequest(params);
      if (request.kind === "invalid") {
        return invalidRequest(REFERENCES_COMMAND, request);
      }

      const admission = await admit(REFERENCES_COMMAND, params, request.value);
      if (admission.kind === "rejected") return admission.response;
      const { echoed } = admission;

      const { file } = request.value;
      const references = await deps.readDocument(file);
      if (references === null) {
        return envelope(REFERENCES_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: fileNotFoundDiagnostic(file),
        });
      }

      return envelope(REFERENCES_COMMAND, {
        ok: true,
        ...echoed,
        entries: referenceEntries(references),
        database: references.database,
        resolution: deps.index.resolution(),
        syntaxes: deps.index.syntaxes(),
      });
    },

    /** Literal prose, no envelope: the page is the whole answer. */
    [CITATIONS_GUIDE_COMMAND]: (params: CliData): string => {
      const request = parseGuideRequest(params);
      return request.kind === "invalid"
        ? invalidRequest(CITATIONS_GUIDE_COMMAND, request)
        : renderCitationsGuide();
    },
  };
}

function invalidRequest(
  command: CitationsCommand,
  request: Extract<ParsedRequest<never>, { kind: "invalid" }>,
): string {
  return envelope(command, {
    ok: false,
    diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
      parameter: request.parameter,
    }),
  });
}

/**
 * The Item a selector names, in the identities the payload reports. One source
 * read answers both the presence a key selector is gated on and the summary
 * every answer carries.
 *
 * @returns `null` when the connected source names no such Item. A database
 *   that cannot be read answers the Item as selected instead: the payload's
 *   `resolution` state is what reports the degradation, so an unreadable
 *   library never masquerades as a missing Item. A citekey selector keeps the
 *   resolution snapshot's verdict on which Item it names, and takes the source
 *   read for the summary alone.
 */
function resolveItem(
  deps: CitationsCliDeps,
  selector: CitedBySelector,
): CitedItem | null {
  if ("citekey" in selector) {
    const { citekey } = selector;
    const resolved = deps.index.resolveCitekey(citekey);
    if (resolved === null) return null;
    const { indexedKey } = resolved;
    return {
      key: indexedKey,
      citekey,
      summary: deps.lookupItem(indexedKey).summary,
    };
  }
  const { key } = selector;
  const { presence, summary } = deps.lookupItem(key);
  if (presence === "absent") return null;
  return { key, citekey: deps.index.citekeyOf(key), summary };
}

function selectorNotFound(selector: CitedBySelector): Diagnostic {
  return "citekey" in selector
    ? citekeyNotFoundDiagnostic(selector.citekey)
    : keyNotFoundDiagnostic(selector.key);
}

/**
 * The document's reference list, in the four kinds a CLI answer distinguishes.
 *
 * A malformed entry names no work, so it sorts in by the one occurrence it
 * carries; every other entry keeps the Reference Number the index assigned it,
 * which leaves the whole list in first-occurrence order.
 */
function referenceEntries({
  citations,
  errors,
  sources,
}: DocumentReferences): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  for (const { indexedKey, refNumber, occurrences } of citations) {
    const reported = reportOccurrences(occurrences);
    if (indexedKey === null) {
      // Every unresolved Citation is written as a citekey — a wikilink that
      // resolves to no Item is no Citation at all — so its raw text names it.
      entries.push({
        refNumber,
        kind: "unresolved",
        citekey: occurrences[0]!.raw,
        occurrences: reported,
      });
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
