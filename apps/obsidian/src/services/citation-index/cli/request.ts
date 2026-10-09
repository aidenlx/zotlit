// Selector parsing: the request each citation command accepts, and the identity it asserts.

import type { CliData } from "obsidian";
import * as v from "valibot";

import { isIndexedKey } from "@zotlit/db";

import {
  cliNotApplicable,
  cliParams,
  cliValue,
  cliVariants,
  decodeCliParams,
  expectSourceParam,
  noCliParams,
} from "@/lib/cli-params";
import type { CliParamName, CliRequest } from "@/lib/cli-params";

import { diagnostic } from "./envelope";
import type { CitationsIdentity, Diagnostic } from "./envelope";

const SELECTOR_EXCLUSIVITY_MESSAGE =
  "cited-by takes exactly one of key=<zotero-key> or citekey=<citation-key>.";

const citedByParams = cliVariants(
  ({ key, citekey }) =>
    key === undefined && citekey !== undefined ? "citekey" : "key",
  {
    key: v.pipe(
      cliParams(
        {
          citekey: cliNotApplicable(
            `${SELECTOR_EXCLUSIVITY_MESSAGE} Both were set.`,
          ),
          key: v.pipe(
            cliValue("key"),
            v.check(isIndexedKey, (issue) => malformedKeyMessage(issue.input)),
          ),
          "expect-source": expectSourceParam,
        },
        { key: `${SELECTOR_EXCLUSIVITY_MESSAGE} Neither was set.` },
      ),
      v.transform(({ key }) => ({ key })),
    ),
    citekey: v.pipe(
      cliParams({
        citekey: cliValue("citekey"),
        "expect-source": expectSourceParam,
      }),
      v.transform(({ citekey }) => ({ citekey })),
    ),
  },
);

/** The one Item `cited-by` reports citers of, named either way round. */
export type CitedBySelector = v.InferOutput<typeof citedByParams>;

/** The parameters of `cited-by`, to type its `CliFlags`. */
export type CitedByParam = CliParamName<typeof citedByParams>;

/**
 * `cited-by` takes exactly one selector: a Zotero key, or a citation key the
 * Citekey Resolution Snapshot answers for. Whether the named Item exists is a
 * handler concern (`KEY_NOT_FOUND`): both the snapshot and the database read
 * only once the index has settled.
 */
export function parseCitedByRequest(
  params: CliData,
): CliRequest<CitedBySelector> {
  return decodeCliParams(params, citedByParams, { command: "cited-by" });
}

const referencesParams = v.pipe(
  cliParams(
    { file: cliValue("file"), "expect-source": expectSourceParam },
    {
      file: "references takes the vault-relative path of one Markdown note, as file=folder/note.md.",
    },
  ),
  v.transform(({ file }) => ({ file })),
);

/** The vault-relative path of the document `references` reads. */
export type ReferencesSelector = v.InferOutput<typeof referencesParams>;

/** The parameters of `references`, to type its `CliFlags`. */
export type ReferencesParam = CliParamName<typeof referencesParams>;

/**
 * `references` takes one vault path, and accepts any Markdown note: a document
 * need not be a Literature Note to cite works. Whether the vault holds a note
 * there is a handler concern (`FILE_NOT_FOUND`), read only once the index has
 * settled.
 */
export function parseReferencesRequest(
  params: CliData,
): CliRequest<ReferencesSelector> {
  return decodeCliParams(params, referencesParams, { command: "references" });
}

const guideParams = v.pipe(
  noCliParams,
  v.transform(() => null),
);

/**
 * The guide answers the same page for every caller, so a parameter can only be
 * a mistaken call: rejecting it keeps a wrong assumption visible.
 */
export function parseGuideRequest(params: CliData): CliRequest<null> {
  return decodeCliParams(params, guideParams, { command: "citations-guide" });
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

function malformedKeyMessage(key: string): string {
  return (
    `'${key}' is not a Zotero key. A Zotero key is an 8-character item key, ` +
    "with a 'g<group-id>' suffix for an item in a group library. " +
    "To select by citation key instead, use citekey=<citation-key>."
  );
}
