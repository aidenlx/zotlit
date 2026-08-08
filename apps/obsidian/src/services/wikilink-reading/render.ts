// The wikilink anchors one rendered reading-view section holds, and the swap
// that puts their Citation Display Text in place.

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
 * The Citation Display Text one link target shows, or null to keep Obsidian's
 * own rendering.
 */
export type WikilinkDisplay = (linktext: string) => string | null;

/**
 * Replaces the display text of every Literature Note wikilink in one rendered
 * section, and nothing else about it: `class`, `href`, and `data-href` stay as
 * Obsidian wrote them, so the target, navigation, and hover stay Obsidian's.
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
 * @returns how many links show their Citation Display Text.
 */
export function renderWikilinkCitations(
  root: HTMLElement,
  display: WikilinkDisplay,
): number {
  let rendered = 0;
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    INTERNAL_LINK,
  )) {
    const linktext = anchor.dataset["href"];
    if (linktext === undefined) continue;
    if (anchor.hasAttribute(ALIAS_MARKER)) continue;
    if (anchor.textContent !== breadcrumb(linktext)) continue;
    const text = display(linktext);
    if (text === null) continue;
    anchor.textContent = text;
    rendered += 1;
  }
  return rendered;
}
