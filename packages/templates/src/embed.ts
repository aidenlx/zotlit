// Markdown-embed helper: prefixes `!` to a lazy link helper's output.

/** A lazy link helper — `link()` renders it; `alias` / `subpath` override the display text or append a `#`-fragment. */
type LinkHelper = (alias?: string, subpath?: string) => string;

/**
 * Render `link` as a Markdown embed by prefixing `!` (so `[...]` becomes
 * `![...]`). Returns `""` when `link` is absent (`null` / `undefined`) or
 * renders empty, so a missing excerpt image collapses cleanly instead of
 * leaving a bare `!`. `alias` / `subpath` forward to the link helper.
 *
 * @example `<%= embed(zt.imgLink) %>`
 */
export function embed(
  link: LinkHelper | null | undefined,
  alias?: string,
  subpath?: string,
): string {
  if (!link) return "";
  const rendered = link(alias, subpath);
  return rendered ? `!${rendered}` : "";
}
