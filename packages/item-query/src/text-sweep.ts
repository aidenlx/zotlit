import { Effect } from "effect";

import {
  readTextSweepWindow,
  TEXT_SWEEP_WINDOW_SIZE,
} from "@zotlit/db/item-query";
import type { TextSweepCandidateLeaf } from "@zotlit/db/item-query";

import type { CandidateFallback, CandidateSources } from "./candidate-plan";
import { isStoredStringField } from "./fields";
import type { FilterNode } from "./filter-plan";

/** A LIKE superset of both JavaScript contains and lowercase contains. */
export function textSweepPattern(text: string): string | null {
  let pattern = "%";
  for (const c of text.toLowerCase()) {
    const keep =
      c <= "\u007f"
        ? c !== "i" && c !== "k" && c !== "%" && c !== "_"
        : c !== "\u0307" && c.toLowerCase() === c && c.toUpperCase() === c;
    if (keep) pattern += c;
    else if (!pattern.endsWith("%")) pattern += "%";
  }
  if (!pattern.endsWith("%")) pattern += "%";
  // The real SQLite driver rejects LIKE patterns above 50,000 UTF-8 bytes.
  return pattern === "%" || new TextEncoder().encode(pattern).length > 50_000
    ? null
    : pattern;
}

/** Only the Item Dataset root offers this lowering. */
export function lowerTextSweep(
  node: FilterNode<never>,
  { vocabulary }: CandidateSources,
): TextSweepCandidateLeaf | null {
  if (
    !vocabulary ||
    node.kind !== "method" ||
    (node.name !== "contains" && node.name !== "icontains") ||
    node.subject.kind !== "field" ||
    !isStoredStringField(node.subject.name) ||
    node.subject.name === "abstractNote" ||
    node.subject.name === "extra" ||
    node.args.length !== 1 ||
    node.args[0]?.kind !== "literal" ||
    typeof node.args[0].value !== "string"
  )
    return null;
  const pattern = textSweepPattern(node.args[0].value);
  return pattern === null
    ? null
    : {
        kind: "text-sweep",
        fieldIDs: vocabulary.fieldIDsOf(node.subject.name),
        pattern,
      };
}

export interface SweepScope {
  readonly maxItemID: number;
  readonly libraryRows: number;
  readonly sparseRatio: number;
}

/** Each yield enters the same statement Effect as scan and hydrate readers. */
export const readTextSweep = Effect.fnUntraced(function* ({
  libraryID,
  leaf,
  limit,
  maxItemID,
  libraryRows,
  sparseRatio,
}: SweepScope & {
  libraryID: number;
  leaf: TextSweepCandidateLeaf;
  limit: number;
}) {
  if (maxItemID > sparseRatio * libraryRows)
    return "sparse-library" satisfies CandidateFallback;
  const windows = Math.ceil(maxItemID / TEXT_SWEEP_WINDOW_SIZE);
  const candidates: number[] = [];
  for (let window = 0; window < windows; window++) {
    const ids = yield* readTextSweepWindow({
      libraryID,
      leaf,
      afterItemID: window * TEXT_SWEEP_WINDOW_SIZE,
      limit: limit - candidates.length,
    });
    candidates.push(...ids);
    if (
      candidates.length >= limit ||
      (window >= 4 && (candidates.length * windows) / (window + 1) > limit - 1)
    )
      return "candidate-cap-exceeded" satisfies CandidateFallback;
  }
  return candidates;
});
