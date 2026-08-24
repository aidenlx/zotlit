// One rendered internal link, as Obsidian's Markdown parser builds it: `href`
// and `data-href` both the raw target, the display text its `#` split, and
// `aria-label` only when the author wrote an alias.
//
// @see docs/research/wikilink-display-decoration-interaction.md — section 6

/** @param alias the author's own display text, when the link carries one. */
export function internalLink(linktext: string, alias?: string): string {
  const breadcrumb = linktext
    .split("#")
    .filter((segment) => segment !== "")
    .join(" > ");
  const aliasAttrs =
    alias === undefined
      ? ""
      : ` aria-label="${breadcrumb}" data-tooltip-position="top"`;
  return (
    `<a data-href="${linktext}" href="${linktext}" class="internal-link"${aliasAttrs}>` +
    `${alias ?? breadcrumb}</a>`
  );
}

/** One rendered section, as a Markdown post-processor receives it. */
export function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
