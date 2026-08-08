// Pure decoration-range computation for the Wikilink Editor Treatment: which
// scanned links show their Citation Display Text, over which range, and with
// which reconstructed token classes.

import { citationDisplayText } from "@/lib/citation-fragment";
import { overlapsSelection } from "@/lib/editor-decoration";
import type { DocRange } from "@/lib/editor-decoration";

import type { WikilinkSpan } from "./scan";

/** The `cite:` marker that tells a wikilink subpath from a heading or block one. */
const FRAGMENT_PREFIX = "cite:";

/** A linkpath and the Citation Fragment its subpath carries, if any. */
export interface CitationLinkTarget {
  /** The link target with its subpath removed. */
  linkpath: string;
  /**
   * The text after `#cite:`, or null when the link carries no Citation
   * Fragment.
   */
  fragment: string | null;
}

/**
 * Splits a link target the way Obsidian's own `parseLinktext` does, then keeps
 * only what the treatment can display: a bare linkpath, or a linkpath whose
 * subpath is a Citation Fragment. A heading or block subpath keeps its own
 * meaning, and a subpath-only link names no note at all.
 *
 * @returns the target, or null when the link is none of the treatment's
 *   business.
 */
export function citationTarget(linktext: string): CitationLinkTarget | null {
  const hash = linktext.indexOf("#");
  if (hash === -1) {
    return linktext === "" ? null : { linkpath: linktext, fragment: null };
  }
  const linkpath = linktext.slice(0, hash);
  if (linkpath === "") return null;
  const subpath = linktext.slice(hash + 1);
  if (!subpath.startsWith(FRAGMENT_PREFIX)) return null;
  return { linkpath, fragment: subpath.slice(FRAGMENT_PREFIX.length) };
}

/** The Literature Note a linkpath names, as the display derivation reads it. */
export interface LiteratureNoteTarget {
  /** The note's vault path; its filename backs the display-text fallback. */
  path: string;
  /** The note's Citation Key Property value, or null when it carries none. */
  citationKey: string | null;
}

export interface WikilinkDisplayContext {
  /**
   * The Literature Note a linkpath resolves to, or null when it resolves to an
   * ordinary note or to nothing. The same predicate the Citation Index applies,
   * so the editor and the sidebar cannot disagree about what a Citation is.
   */
  literatureNote: (linkpath: string) => LiteratureNoteTarget | null;
  /**
   * Whether a link carrying no Citation Fragment may be decorated — Wikilink
   * Citations and the wikilink display toggle both on. A link that carries one
   * is decorated either way: the fragment is unambiguous ZotLit intent, and
   * Pandoc export honors it regardless of settings.
   */
  fragmentlessDisplay: boolean;
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
 * Left alone, each for its own reason: an embed, because Obsidian replaces the
 * whole construct and the Citation Index omits it; an aliased link, because the
 * alias is the display the author already chose; a heading or block subpath,
 * because it is not a Citation Fragment; a link resolving to no Literature
 * Note; and a malformed Citation Fragment, which renders raw rather than
 * guessing at what the exporter would reject.
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
    const target = citationTarget(span.linktext);
    if (target === null) continue;
    if (target.fragment === null && !context.fragmentlessDisplay) continue;
    const note = context.literatureNote(target.linkpath);
    if (note === null) continue;
    const display = citationDisplayText({
      citationKey: note.citationKey,
      notePath: note.path,
      fragment: target.fragment,
    });
    if (display.kind === "raw") continue;
    decorations.push({
      from: span.inner.from,
      to: span.inner.to,
      text: display.text,
      tokenClasses: span.tokenClasses,
    });
  }
  return decorations;
}
