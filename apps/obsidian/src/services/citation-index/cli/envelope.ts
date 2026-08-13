// The JSON envelope every citation command answers with, and its diagnostics.
//
// Diagnostic `message` and `hint` text stays literal English: `code` is the
// stable machine surface agent scripts read, the message is context for a human
// reading the transcript, and the hint is the recovery action the agent acts on.
// Command and flag help text is localized (see `register.ts`).

import type {
  CitationCoverage,
  CitationKeyResolution,
  CitedByGroup,
} from "@/services/citation-index/service";

/** The wire format of the `zotlit:` citation commands, versioned on its own. */
export const CONTRACT_VERSION = 1;

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
 * The documented diagnostic codes of contract version 1, each defined with
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
    | { citekey: string };
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

/** The commands the citations namespace answers. */
export type CitationsCommand = "zotlit:cited-by";

/** The Item a cited-by answer resolved its selector to. */
export interface CitedItem {
  /** Zotero key: the cross-library identity ZotLit indexes by. */
  key: string;
  /** The Item's citation key, or `null` when Zotero holds none for it. */
  citekey: string | null;
}

/** `zotlit:cited-by`'s result: index facts, never view presentation (ADR 0024). */
interface CitedByPayload {
  item: CitedItem;
  /** Citing notes in path order, each with its Citation Occurrences. */
  groups: readonly CitedByGroup[];
  coverage: CitationCoverage;
  resolution: CitationKeyResolution;
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
  | (EnvelopeFacts & { ok: true } & CitedByPayload);

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
