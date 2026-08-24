// The Items an Ambiguous Citation Key names, listed the same way wherever a surface shows them.

import { candidateRow } from "@/services/citation-index/ambiguity";
import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";

/**
 * One row per candidate, in the order the resolution snapshot reports them:
 * the Item summary, then its Library name and bare Zotero item key — the three
 * facts that tell two candidates of one Library apart.
 *
 * @param textClass the surface's own entry text class, so the rows read as the
 *   entries they stand among.
 */
export function AmbiguousCandidates({
  candidates,
  textClass,
}: {
  candidates: readonly AmbiguousCandidate[];
  textClass: string;
}) {
  return (
    <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-1 zt:p-0">
      {candidates.map((candidate) => {
        const row = candidateRow(candidate);
        return (
          <li key={candidate.indexedKey} className={textClass}>
            <div className="zt:text-foreground zt:select-text">
              {row.summary}
            </div>
            <div className="zt:flex zt:gap-2 zt:text-xs zt:text-muted-foreground">
              {row.library !== null && <span>{row.library}</span>}
              <span>{row.key}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
