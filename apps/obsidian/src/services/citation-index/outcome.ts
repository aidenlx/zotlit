// The resolution verdict attached when a Document Citation Set joins its sources.
import type { AmbiguousCandidate } from "./ambiguity";
import type { Citation } from "./query";
import type { CitekeyResolution } from "./snapshot";
import type { ReferenceSource, DatabaseReadability } from "./sources";

export type CitationOutcome =
  | { kind: "resolved"; source: ReferenceSource }
  | { kind: "missing-item"; key: string }
  | { kind: "missing-annotation"; annotationKey: string }
  | { kind: "unresolved-key"; citekey: string }
  | {
      kind: "ambiguous-key";
      citekey: string;
      candidates: readonly AmbiguousCandidate[];
    }
  | { kind: "malformed" }
  | { kind: "unreadable" };

export function citationOutcome(
  citation: Citation,
  {
    sources,
    database,
    resolution,
    candidates = [],
  }: {
    sources: ReadonlyMap<string, ReferenceSource>;
    database: DatabaseReadability;
    resolution?: CitekeyResolution | null;
    candidates?: readonly AmbiguousCandidate[];
  },
): CitationOutcome {
  if (database === "unreadable") return { kind: "unreadable" };
  if (citation.indexedKey !== null) {
    const source = sources.get(citation.indexedKey);
    return source
      ? { kind: "resolved", source }
      : { kind: "missing-item", key: citation.indexedKey };
  }
  const first = citation.occurrences[0]!;
  if (first.kind === "annotation")
    return { kind: "missing-annotation", annotationKey: first.raw };
  return resolution?.kind === "ambiguous" || candidates.length > 0
    ? { kind: "ambiguous-key", citekey: first.raw, candidates }
    : { kind: "unresolved-key", citekey: first.raw };
}
