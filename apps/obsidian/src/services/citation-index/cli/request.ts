// Selector parsing: the request each citation command accepts, and the identity it asserts.

import type { CliData } from "obsidian";

import { isIndexedKey } from "@zotlit/db";

import { diagnostic } from "./envelope";
import type { CitationsIdentity, Diagnostic } from "./envelope";

/** A parsed selector, or the one parameter that made it invalid. */
export type ParsedRequest<T> =
  | { kind: "valid"; value: T }
  | { kind: "invalid"; parameter: string; message: string };

/**
 * Per-command accepted-parameter lists: the single source of truth `satisfies
 * Record<..., CliFlag>` in `register.ts` types each command's help metadata
 * against, so the declared flags and this allowlist cannot drift apart.
 */
export const CITED_BY_PARAMS = ["key", "citekey", "expect-source"] as const;

export const REFERENCES_PARAMS = ["file", "expect-source"] as const;

/** The guide serves one page, so it takes no parameters at all. */
export const CITATIONS_GUIDE_PARAMS = [] as const;

/** The one Item `cited-by` reports citers of, named either way round. */
export type CitedBySelector = { key: string } | { citekey: string };

/**
 * `cited-by` takes exactly one selector: a Zotero key, or a citation key the
 * Citekey Resolution Snapshot answers for. Whether the named Item exists is a
 * handler concern (`KEY_NOT_FOUND`): both the snapshot and the database read
 * only once the index has settled.
 */
export function parseCitedByRequest(
  params: CliData,
): ParsedRequest<CitedBySelector> {
  const rejected = rejectAccepted(params, "cited-by", CITED_BY_PARAMS);
  if (rejected) return invalid(rejected.parameter, rejected.message);
  for (const parameter of ["key", "citekey"]) {
    if (bareFlag(params, parameter)) {
      return invalid(parameter, `${parameter} requires a value.`);
    }
  }

  const { key, citekey } = params;
  if (key !== undefined && citekey !== undefined) {
    return invalid("citekey", `${SELECTOR_EXCLUSIVITY_MESSAGE} Both were set.`);
  }
  if (key !== undefined) {
    return isIndexedKey(key)
      ? withExpectations(params, { key })
      : invalid("key", malformedKeyMessage(key));
  }
  if (citekey !== undefined) return withExpectations(params, { citekey });
  return invalid("key", `${SELECTOR_EXCLUSIVITY_MESSAGE} Neither was set.`);
}

/** The one document `references` reports the Citations of. */
export interface ReferencesSelector {
  /** Vault-relative path of the document. */
  file: string;
}

/**
 * `references` takes one vault path, and accepts any Markdown note: a document
 * need not be a Literature Note to cite works. Whether the vault holds a note
 * there is a handler concern (`FILE_NOT_FOUND`), read only once the index has
 * settled.
 */
export function parseReferencesRequest(
  params: CliData,
): ParsedRequest<ReferencesSelector> {
  const rejected = rejectAccepted(params, "references", REFERENCES_PARAMS);
  if (rejected) return invalid(rejected.parameter, rejected.message);
  if (bareFlag(params, "file"))
    return invalid("file", "file requires a value.");

  const { file } = params;
  if (file === undefined) {
    return invalid(
      "file",
      "references takes the vault-relative path of one Markdown note, as file=folder/note.md.",
    );
  }
  return withExpectations(params, { file });
}

/**
 * The guide answers the same page for every caller, so a parameter can only be
 * a mistaken call: rejecting it keeps a wrong assumption visible.
 */
export function parseGuideRequest(params: CliData): ParsedRequest<null> {
  const rejected = rejectAccepted(
    params,
    "citations-guide",
    CITATIONS_GUIDE_PARAMS,
  );
  return rejected
    ? invalid(rejected.parameter, rejected.message)
    : { kind: "valid", value: null };
}

/**
 * Report the Zotero source the caller asserted when it differs from the
 * connected one, so an agent never reads citation facts from the wrong library.
 */
export function targetMismatch(
  params: CliData,
  identity: CitationsIdentity,
): Diagnostic | null {
  const expectedSource = params["expect-source"];
  if (expectedSource !== undefined && expectedSource !== identity.source.id) {
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected Zotero source '${expectedSource}', connected to '${identity.source.id ?? "unresolved"}'.`,
      {
        target: "source",
        expected: expectedSource,
        actual: identity.source.id,
      },
    );
  }
  return null;
}

/** Obsidian's CLI reports a flag passed without a value as the string `"true"`. */
function bareFlag(params: CliData, parameter: string): boolean {
  return params[parameter] === "true";
}

/** Reject a bare identity assertion, which would assert nothing. */
function withExpectations<T>(params: CliData, value: T): ParsedRequest<T> {
  if (bareFlag(params, "expect-source")) {
    return invalid("expect-source", "expect-source requires a value.");
  }
  return { kind: "valid", value };
}

/**
 * Obsidian passes every caller token straight through as `CliData`, filtering
 * nothing itself, so a command must reject what it did not declare. A `--*`
 * token is left for Obsidian or its CLI binary and skipped; `vault` typed after
 * the command name reached us only because Obsidian's own vault selection
 * already ran (and ran on the wrong vault, since this call named one); anything
 * else is an unrecognized parameter for the command.
 */
function rejectAccepted(
  params: CliData,
  command: string,
  accepted: readonly string[],
): { parameter: string; message: string } | null {
  for (const key of Object.keys(params)) {
    if (key.startsWith("--") || accepted.includes(key)) continue;
    if (key === "vault") {
      return { parameter: "vault", message: VAULT_AFTER_COMMAND_MESSAGE };
    }
    return {
      parameter: key,
      message:
        accepted.length > 0
          ? `Unknown parameter '${key}' for ${command}. Accepted parameters: ${accepted.join(", ")}.`
          : `Unknown parameter '${key}': ${command} takes no parameters.`,
    };
  }
  for (const key of accepted) {
    if (params[key] === "") {
      return { parameter: key, message: `${key} requires a value.` };
    }
  }
  return null;
}

const SELECTOR_EXCLUSIVITY_MESSAGE =
  "cited-by takes exactly one of key=<zotero-key> or citekey=<citation-key>.";

const VAULT_AFTER_COMMAND_MESSAGE =
  "vault must come before the command name (obsidian-cli vault=<name> zotlit:...); placed after, Obsidian ignores it and routes the call by working directory or focused window instead.";

function malformedKeyMessage(key: string): string {
  return (
    `'${key}' is not a Zotero key. A Zotero key is an 8-character item key, ` +
    "with a 'g<group-id>' suffix for an item in a group library. " +
    "To select by citation key instead, use citekey=<citation-key>."
  );
}

function invalid<T>(parameter: string, message: string): ParsedRequest<T> {
  return { kind: "invalid", parameter, message };
}
