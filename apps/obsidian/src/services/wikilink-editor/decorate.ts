// Pure decoration-range computation for the Wikilink Editor Treatment: which
// scanned links show their Citation Display Text, over which range, and with
// which reconstructed token classes.

import { overlapsSelection } from "@/lib/editor-decoration";
import type { DocRange } from "@/lib/editor-decoration";
import { wikilinkDisplayText } from "@/lib/wikilink-citation";
import type { WikilinkCitationContext } from "@/lib/wikilink-citation";

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
}

/** One link to replace, with everything its widget needs. */
export interface WikilinkDecoration extends DocRange {
  /** The Citation Display Text shown in place of the raw path and fragment. */
  text: string;
  /** {@link WikilinkSpan.tokenClasses} */
  tokenClasses: readonly string[];
}

/**
 * The links that show their Citation Display Text, in document order.
 *
 * Beyond what the shared derivation leaves alone, two exclusions are this
 * surface's own: an embed, because Obsidian replaces the whole construct and
 * the Citation Index omits it; and an aliased link, because the alias is the
 * display the author already chose.
 */
export function wikilinkDecorations(
  spans: readonly WikilinkSpan[],
  context: WikilinkDisplayContext,
): WikilinkDecoration[] {
  const decorations: WikilinkDecoration[] = [];
  for (const span of spans) {
    if (span.isEmbed || span.hasAlias) continue;
    if (overlapsSelection(context.selection, span.group.from, span.group.to)) {
      continue;
    }
    const text = wikilinkDisplayText(span.linktext, context);
    if (text === null) continue;
    decorations.push({
      from: span.inner.from,
      to: span.inner.to,
      text,
      tokenClasses: span.tokenClasses,
    });
  }
  return decorations;
}
