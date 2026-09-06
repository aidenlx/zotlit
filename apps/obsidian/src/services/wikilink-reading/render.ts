// The wikilink Citations one rendered reading-view section holds, and the swap
// that puts their formatted text in place.

import { themeHook } from "@/lib/theme-hooks";
import { citationRuns } from "@/lib/wikilink-citation";
import type { RunMember, WikilinkCitation } from "@/lib/wikilink-citation";
import { showCitation } from "@/services/citation-text/present";
import type { PresentedCitation } from "@/services/citation-text/present";

/**
 * Obsidian's own anchor for an internal link, which its Markdown parser builds
 * before any post-processor runs. `data-href` carries the raw link target,
 * subpath included.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
const INTERNAL_LINK = "a.internal-link";

/**
 * Obsidian's own marker for an aliased link: its parser writes `aria-label`
 * with the target's breadcrumb only when the display text is the author's own,
 * so an alias that reads exactly like the breadcrumb is still an alias here.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
const ALIAS_MARKER = "aria-label";

/**
 * Obsidian's own display text for a link target: the `#` split rejoined with
 * ` > `, which is what renders a Citation Fragment as a breadcrumb.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
function breadcrumb(linktext: string): string {
  return linktext
    .split("#")
    .filter((segment) => segment !== "")
    .join(" > ")
    .trim();
}

/**
 * The Citation one link target writes, or null to keep Obsidian's own
 * rendering.
 */
export type WikilinkCitationOf = (linktext: string) => WikilinkCitation | null;

/**
 * The formatted text one Citation Run shows in place of its links, or null to
 * leave them as Obsidian rendered them.
 *
 * `index` is the run's place in the section's own document order, which is what
 * tells two identical Citations of one section apart.
 */
export type FormatWikilinkRun = (
  run: readonly RunMember<HTMLAnchorElement>[],
  index: number,
) => PresentedCitation | null;

/** The Citation Runs of one rendered section, as their anchors carry them. */
export type SectionRuns = (readonly RunMember<HTMLAnchorElement>[])[];

/** @returns whether `root` holds an internal link at all, Citation or not. */
export function hasInternalLink(root: HTMLElement): boolean {
  return root.querySelector(INTERNAL_LINK) !== null;
}

/**
 * The Citation Runs of one rendered section, in document order.
 *
 * An aliased link keeps its alias, the display the author already chose — the
 * same exclusion Live Preview makes, so the two surfaces agree on every link.
 * So does an anchor showing anything but Obsidian's own rendering of its
 * target, which is text some other post-processor wrote.
 *
 * An embed needs no exclusion of its own: Obsidian renders it as an embed
 * container rather than an anchor, so this pass never reaches one.
 *
 * @param root one rendered section, as a Markdown post-processor receives it.
 */
export function sectionCitationRuns(
  root: HTMLElement,
  citationOf: WikilinkCitationOf,
): SectionRuns {
  return citationRuns(
    [...root.querySelectorAll<HTMLAnchorElement>(INTERNAL_LINK)],
    (anchor) => citationRendered(anchor, citationOf),
    textBetween,
  );
}

/**
 * Shows each Citation Run as what `format` returns for it. It keeps Obsidian's
 * native link classes, `href`, and `data-href`, then appends the public
 * Citation and Literature Note link hooks, so the target and navigation stay
 * Obsidian's.
 *
 * A run of several works collapses into its first anchor, so the whole run
 * navigates to the first work it names — the same narrowing the Live Preview
 * run widget makes, and the one place a run departs from #663's per-link
 * interaction. A lone Citation keeps its anchor and every gesture on it.
 *
 * The formatted text goes into Obsidian's own anchor, so a link the style wrote
 * shows as the text it carries: an anchor inside an anchor is invalid, and the
 * one this surface writes into already navigates to the Literature Note.
 *
 * @returns how many Citations show their formatted text.
 */
export function renderCitationRuns(
  runs: SectionRuns,
  format: FormatWikilinkRun,
): number {
  let rendered = 0;
  for (const [index, run] of runs.entries()) {
    const content = format(run, index);
    if (content === null) continue;
    const first = run[0]!.source;
    // Everything between the run's anchors is the separators that joined them,
    // so the run leaves one anchor behind and nothing else of its source.
    for (const { source } of run.slice(1)) {
      removeBetween(first, source);
      source.remove();
    }
    showCitation(first, content, "suppress");
    first.classList.add(themeHook.citation, themeHook.literatureNoteLink);
    rendered += 1;
  }
  return rendered;
}

/** @returns the Citation `anchor` writes, or null when it writes none. */
function citationRendered(
  anchor: HTMLAnchorElement,
  citationOf: WikilinkCitationOf,
): WikilinkCitation | null {
  const linktext = anchor.dataset["href"];
  if (linktext === undefined) return null;
  if (anchor.hasAttribute(ALIAS_MARKER)) return null;
  if (anchor.textContent !== breadcrumb(linktext)) return null;
  return citationOf(linktext);
}

/**
 * The text between two anchors, which decides whether they join into one
 * Citation Run.
 *
 * Only plain text may lie between them: an element there is a `<br>` that ended
 * the line, an inline container the run does not span, or a sibling this pass
 * has no claim on, and each of those ends the run. Anchors in two different
 * parents likewise never join, which is what keeps a paragraph break — which
 * writes no text of its own — from reading as an empty separator.
 *
 * @returns the text, or null when the two are not joinable at all.
 */
function textBetween(
  previous: HTMLAnchorElement,
  anchor: HTMLAnchorElement,
): string | null {
  if (previous.parentNode !== anchor.parentNode) return null;
  let text = "";
  for (
    let node = previous.nextSibling;
    node !== anchor;
    node = node?.nextSibling ?? null
  ) {
    if (node === null || node.nodeType !== Node.TEXT_NODE) return null;
    text += node.nodeValue ?? "";
  }
  return text;
}

/** Drops the separator nodes a run's anchors were joined by. */
function removeBetween(from: ChildNode, to: ChildNode): void {
  for (let node = from.nextSibling; node !== null && node !== to; ) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
}
