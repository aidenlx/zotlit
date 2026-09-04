// The JSON envelope every citation command answers with, its diagnostics, and
// the position base an answer reports in.
//
// Diagnostic `message` and `hint` text stays literal English: `code` is the
// stable machine surface agent scripts read, the message is context for a human
// reading the transcript, and the hint is the recovery action the agent acts on.
// Command and flag help text is localized (see `register.ts`).

import type { Loc } from "obsidian";

import type {
  CitationCoverage,
  CitationKeyResolution,
  CitationOccurrence,
  CitationSyntax,
  CitationSyntaxes,
  CitedByGroup,
  DatabaseReadability,
  SnapshotItem,
} from "@/services/citation-index/service";

/** The wire format of the `zotlit:` citation commands, versioned on its own. */
export const CONTRACT_VERSION = 3;

/** Identity of the vault and Zotero source a command answered from. */
export interface CitationsIdentity {
  vault: {
    name: string;
    /** Absolute path of the vault folder on this device. */
    path: string;
  };
  source: {
    id: string | null;
    databasePath: string;
  };
}

/**
 * The documented diagnostic codes of contract version 3, each defined with
 * the recovery action its diagnostic carries. This record is the single source
 * of both, so a new code arrives with its own hint.
 */
export const DIAGNOSTIC_HINTS = {
  INVALID_SELECTOR:
    "Correct the parameter named in details.parameter, then run the command again.",
  TARGET_MISMATCH:
    "Confirm the intended Zotero source with the user before you query citations again.",
  INDEX_NOT_READY:
    "Run the command again after a short wait; the Citation Index is still scanning the vault or resolving citation keys.",
  KEY_NOT_FOUND:
    "Select a Zotero key or a citation key that names an item in the connected Zotero source.",
  AMBIGUOUS_CITEKEY:
    "Run the command again with key=<zotero-key>, taken from the candidates in details.",
  FILE_NOT_FOUND:
    "Pass file= the vault-relative path of a Markdown note, as file=folder/note.md.",
} as const satisfies Record<string, string>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  /** The recovery action for `code`, taken from `DIAGNOSTIC_HINTS`. */
  hint: string;
  details?:
    | { parameter: string }
    | { target: "source"; expected: string; actual: string | null }
    | { key: string }
    | { citekey: string }
    | { citekey: string; candidates: readonly AmbiguousCandidateKey[] }
    | { file: string };
}

/**
 * One item an Ambiguous Citation Key names, by the key that selects it alone.
 *
 * Index facts only (ADR 0024): the library is named by its local id rather
 * than by the display name a sidebar shows, and item data stays with
 * `zotlit:template-data`, which the exact key here selects.
 */
export interface AmbiguousCandidateKey {
  /** Zotero key: the cross-library identity ZotLit indexes by. */
  key: string;
  /** Local id of the library holding the item, which names that library. */
  libraryID: number;
}

/** The candidates of one Ambiguous Citation Key, as every answer reports them. */
export function reportCandidates(
  candidates: readonly SnapshotItem[],
): AmbiguousCandidateKey[] {
  return candidates.map(({ indexedKey, libraryID }) => ({
    key: indexedKey,
    libraryID,
  }));
}

/**
 * Report a fault with the recovery action its code defines. Every diagnostic is
 * built here, so `hint` can never disagree with `code`.
 */
export function diagnostic(
  code: DiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return { code, message, hint: DIAGNOSTIC_HINTS[code], details };
}

export type CitationsCommand =
  | "zotlit:cited-by"
  | "zotlit:references"
  | "zotlit:citations-guide";

/** The Item a cited-by answer resolved its selector to. */
export interface CitedItem {
  /** Zotero key: the cross-library identity ZotLit indexes by. */
  key: string;
  /** The Item's citation key, or `null` when Zotero holds none for it. */
  citekey: string | null;
  /** `Creators (Year): Title` from the shared item-summary rendering, or
   *  `null` when the Zotero source renders no summary for the Item: a read it
   *  could not answer, or an Item that names no work of its own. */
  summary: string | null;
}

/** One end of a reported position (ADR 0025). */
interface ReportedLoc {
  /** Counts from 1, as an editor and `rg --line-number` do. */
  line: number;
  /** Counts from 1, in UTF-16 code units. `rg --column` counts bytes, so the
   *  two differ on a line that holds non-ASCII text. */
  col: number;
  /** Counts UTF-16 code units from 0, start inclusive and end exclusive. */
  offset: number;
}

/**
 * A Citation Occurrence as an answer reports it: `kind` and `raw` are the
 * index's own, and only the position is re-based.
 *
 * @see CitationOccurrence
 */
export interface ReportedOccurrence {
  kind: CitationSyntax;
  raw: string;
  position: { start: ReportedLoc; end: ReportedLoc };
}

/** The reported Citation Occurrences in one citing Markdown note. */
interface ReportedGroup {
  path: string;
  occurrences: readonly ReportedOccurrence[];
}

/**
 * Re-base the positions of one note's Citation Occurrences for the wire.
 *
 * This is the only place a position changes base (ADR 0025): the Citation
 * Index, the occurrence scanner, and both sidebars keep the 0-based positions
 * Obsidian itself works in.
 */
export function reportOccurrences(
  occurrences: readonly CitationOccurrence[],
): ReportedOccurrence[] {
  return occurrences.map(({ kind, raw, position }) => ({
    kind,
    raw,
    position: {
      start: reportLoc(position.start),
      end: reportLoc(position.end),
    },
  }));
}

export function reportGroups(groups: readonly CitedByGroup[]): ReportedGroup[] {
  return groups.map(({ path, occurrences }) => ({
    path,
    occurrences: reportOccurrences(occurrences),
  }));
}

/** `offset` addresses the file's text rather than a screen, so it keeps the
 *  base that makes `end.offset - start.offset` the fragment's length. */
function reportLoc({ line, col, offset }: Loc): ReportedLoc {
  return { line: line + 1, col: col + 1, offset };
}

/** `zotlit:cited-by`'s result: index facts, never view presentation (ADR 0024). */
interface CitedByPayload {
  item: CitedItem;
  /** Citing notes in path order, each with its Citation Occurrences. */
  groups: readonly ReportedGroup[];
  /** The excluded Citation Syntaxes that wrote occurrences of this Item this
   *  answer left out. `[]` means the answer withheld nothing. */
  omittedSyntaxes: readonly CitationSyntax[];
  coverage: CitationCoverage;
  resolution: CitationKeyResolution;
  /** Which Citation Syntaxes admit occurrences into `groups`: an excluded
   *  syntax's occurrences appear in no group. */
  syntaxes: CitationSyntaxes;
}

/**
 * One entry of a document's reference list. The References Sidebar's seven
 * kinds collapse to five here, because the rendered / summary / unrendered
 * distinction only reports Pandoc Engine state (ADR 0024):
 *
 * - `resolved` — a cited Item the connected Zotero source holds, with its identity.
 * - `unresolved` — a citation key that names no live Zotero Item.
 * - `ambiguous` — a citation key several Items carry in the current library
 *   scope, so it names none of them; the candidates carry the exact keys that
 *   each select one.
 * - `missing` — an Item the index cites that the database no longer holds.
 * - `malformed` — citation intent that cannot be parsed, so it names no work
 *   and joins no Document Citation Set; it therefore carries no Reference Number.
 */
export type ReferenceEntry = { occurrences: readonly ReportedOccurrence[] } & (
  | {
      refNumber: number;
      kind: "resolved";
      /** Zotero key: the cross-library identity ZotLit indexes by. */
      key: string;
      citekey: string | null;
      /** `Creators (Year): Title` from the shared item-summary rendering. */
      summary: string;
      /** Linkpath of the Literature Note, or `null` when the Item has none yet. */
      linkpath: string | null;
    }
  | { refNumber: number; kind: "unresolved"; citekey: string }
  | {
      refNumber: number;
      kind: "ambiguous";
      citekey: string;
      /** Every candidate, in the resolution snapshot's own order. */
      candidates: readonly AmbiguousCandidateKey[];
    }
  | { refNumber: number; kind: "missing"; key: string }
  | { kind: "malformed" }
);

/**
 * `zotlit:references`'s result: index facts, never view presentation (ADR 0024).
 *
 * The two states are what an entry kind means: they report a degraded read as
 * data instead of as entries. Coverage stays out — a document is read on
 * demand, so the vault-wide scan cannot change this answer.
 */
interface ReferencesPayload {
  /** The document's entries in first-occurrence order. */
  entries: readonly ReferenceEntry[];
  /** The excluded Citation Syntaxes that wrote occurrences in this document
   *  this answer left out. `[]` means the answer withheld nothing. */
  omittedSyntaxes: readonly CitationSyntax[];
  /** `"unreadable"` reports every cited work as `missing`, whether or not the
   *  Zotero source still holds it. */
  database: DatabaseReadability;
  /** An `unresolved` entry names a citation key no Item carries only while
   *  this is `"fresh"`; a stale snapshot resolves a live key to nothing. */
  resolution: CitationKeyResolution;
  /** Which Citation Syntaxes admit occurrences into `entries`: an excluded
   *  syntax's occurrences appear in no entry. */
  syntaxes: CitationSyntaxes;
}

/** The facts a command echoes back beside its result, both optional because a
 *  selector-level failure is answered before either is resolved. */
interface EnvelopeFacts {
  request?: object;
  identity?: CitationsIdentity;
}

/**
 * Everything an envelope carries after `contractVersion` and `command`. `ok`
 * discriminates, so a failure cannot carry a result and a result cannot carry
 * a diagnostic. Field order is the literal's own order, so each call site
 * lists its fields in the order the contract documents them.
 */
export type EnvelopeTail =
  | (EnvelopeFacts & { ok: false; diagnostic: Diagnostic })
  | (EnvelopeFacts & { ok: true } & (CitedByPayload | ReferencesPayload));

export function envelope(
  command: CitationsCommand,
  tail: EnvelopeTail,
): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

export function notSettledDiagnostic(timeoutMs: number): Diagnostic {
  return diagnostic(
    "INDEX_NOT_READY",
    `The Citation Index did not settle within ${timeoutMs} ms.`,
  );
}

export function keyNotFoundDiagnostic(key: string): Diagnostic {
  return diagnostic("KEY_NOT_FOUND", `No Zotero item matches '${key}'.`, {
    key,
  });
}

export function citekeyNotFoundDiagnostic(citekey: string): Diagnostic {
  return diagnostic(
    "KEY_NOT_FOUND",
    `No Zotero item carries the citation key '${citekey}'.`,
    { citekey },
  );
}

/** An Ambiguous Citation Key names several items, so it selects none of them.
 *  The candidates carry the exact keys that each select one. */
export function ambiguousCitekeyDiagnostic(
  citekey: string,
  candidates: readonly AmbiguousCandidateKey[],
): Diagnostic {
  return diagnostic(
    "AMBIGUOUS_CITEKEY",
    `${candidates.length} Zotero items carry the citation key '${citekey}' in the current library scope.`,
    { citekey, candidates },
  );
}

export function fileNotFoundDiagnostic(file: string): Diagnostic {
  return diagnostic(
    "FILE_NOT_FOUND",
    `The vault holds no Markdown note at '${file}'.`,
    { file },
  );
}
