// Pure decoration-range computation for the Wikilink Editor Treatment: which
// scanned links form a Citation, over which range, and with which reconstructed
// token classes.

import { overlapsSelection } from "@/lib/editor-decoration";
import type { DocRange } from "@/lib/editor-decoration";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import type {
  RunCitationSource,
  WikilinkCitationContext,
} from "@/lib/wikilink-citation";

import type { WikilinkSpan } from "./scan";

export interface WikilinkDisplayContext extends WikilinkCitationContext {
  /**
   * The selection ranges that reveal raw text, which a blurred editor reports
   * as none — blur conceals everything, the way Obsidian's own live preview
   * reads it.
   *
   * Known gap: Obsidian's own reveal predicate is selection overlap OR
   * highlight overlap, and the highlight half — `Editor.addHighlights` ranges
   * and the search-match set — lives in Obsidian internals with no public
   * handle. So while a search match highlights a decorated link, Obsidian
   * reveals its brackets but the widget stays, and the link shows as
   * `[[@wang2020, p. 7]]` until the highlight clears.
   *
   * @see docs/research/wikilink-display-decoration-interaction.md — section 4.1
   */
  selection: readonly DocRange[];
  /**
   * The document text of one range, which is what decides whether two links
   * are joined by a `;` into one Citation Run.
   */
  textBetween: (from: number, to: number) => string;
}

/** One Citation to replace, with everything its widget needs. */
export interface WikilinkDecoration extends DocRange {
  /** The Pandoc source of the Citation and the works it names, which a formatted render is keyed by. */
  citation: RunCitationSource;
  /**
   * Document offset the Citation starts at — its first `[[`, the offset
   * Obsidian's own link cache reports — which picks out its occurrence.
   * {@link DocRange.from} is the narrower inner range the widget replaces.
   */
  start: number;
  /** {@link WikilinkSpan.tokenClasses} */
  tokenClasses: readonly string[];
}

/**
 * The Citations to replace, in document order — one decoration per Citation
 * Run, so a run reads as the single grouped Citation export writes.
 *
 * Beyond what the shared derivation leaves alone, two exclusions are this
 * surface's own: an embed, because Obsidian replaces the whole construct and
 * the Citation Index omits it; and an aliased link, because the alias is the
 * display the author already chose. Either one also ends a run, since a link
 * that shows its own text cannot be folded into a neighbour's Citation.
 */
export function wikilinkDecorations(
  spans: readonly WikilinkSpan[],
  context: WikilinkDisplayContext,
): WikilinkDecoration[] {
  const runs = citationRuns(
    spans,
    (span) =>
      span.isEmbed || span.hasAlias
        ? null
        : wikilinkCitation(span.linktext, context),
    (previous, next) => context.textBetween(previous.outer.to, next.outer.from),
  );

  const decorations: WikilinkDecoration[] = [];
  for (const run of runs) {
    const first = run[0]!.source;
    const last = run.at(-1)!.source;
    // A run reveals as one unit: any contact with the conceal group of any of
    // its members brings the whole run's raw text back.
    if (overlapsSelection(context.selection, first.group.from, last.group.to)) {
      continue;
    }
    const citation = citationOfRun(run);
    decorations.push({
      from: first.inner.from,
      to: last.inner.to,
      citation,
      start: first.outer.from,
      tokenClasses: first.tokenClasses,
    });
  }
  return decorations;
}
