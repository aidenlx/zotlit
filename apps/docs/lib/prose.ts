/**
 * The "quiet manuscript" prose restyle — sans body, serif display headings
 * (h1–h3), a mono-uppercase h4 label, serif-italic quotes/captions, and a
 * tighter list rhythm. Applied on the docs page and blog post bodies. Serif
 * headings sit one notch above the stock em-based scale to compensate Gelasio's
 * smaller x-height.
 *
 * Expressed as Fumadocs/tailwindcss-typography element modifiers — the plugin's
 * customization surface — not hand-written `.prose`-descendant CSS: the
 * modifiers carry the `not-prose` escape hatch and win over base `prose` by
 * layer order. The fork's variants are single-element only, so descendant
 * compounds (`li p`, nested `li ul/ol`) fall back to Tailwind arbitrary
 * variants, which do NOT carry that guard.
 *
 * @see DESIGN.md → CSS architecture
 */
export const ztProse = [
  "font-sans",
  "prose-h1:font-serif prose-h1:font-medium prose-h1:text-balance prose-h1:text-[2.125em] prose-h1:leading-[1.2]",
  "prose-h2:font-serif prose-h2:font-medium prose-h2:text-balance prose-h2:text-[1.625em] prose-h2:leading-[1.3]",
  "prose-h3:font-serif prose-h3:font-medium prose-h3:text-balance prose-h3:text-[1.375em] prose-h3:leading-[1.45]",
  "prose-h4:font-mono prose-h4:font-semibold prose-h4:uppercase prose-h4:tracking-[0.08em] prose-h4:text-[0.9em]",
  "prose-blockquote:font-serif prose-blockquote:font-normal prose-blockquote:text-[1.125em] prose-blockquote:leading-[1.6]",
  "prose-figcaption:font-serif prose-figcaption:italic prose-figcaption:text-[0.9375em]",
  "prose-kbd:font-mono",
  "prose-code:rounded-none",
  "prose-ul:my-[0.75em] prose-ol:my-[0.75em] prose-li:my-[0.25em] prose-li:leading-[1.6]",
  "[&_li_p]:my-[0.375em] [&_li_ul]:my-[0.25em] [&_li_ol]:my-[0.25em]",
].join(" ");

/**
 * Shared type roles for the changelog list + detail bodies: sans body, the
 * mono-uppercase `##` category label with its accent left-bar (the repo-datum
 * motif), serif `###` feature names, square inline code. Each view layers its
 * own density — sizes, margins, tracking, bar dimensions — on top.
 *
 * @see DESIGN.md → Changelog
 */
export const changelogProseRoles = [
  "prose max-w-none font-sans prose-sm text-fd-muted-foreground",
  "prose-code:rounded-none",
  "prose-h2:font-mono prose-h2:font-semibold prose-h2:text-fd-foreground prose-h2:uppercase",
  "prose-h2:before:inline-block prose-h2:before:w-0.5 prose-h2:before:translate-y-px prose-h2:before:bg-fd-primary prose-h2:before:align-middle prose-h2:before:content-['']",
  "prose-h3:font-serif prose-h3:font-medium",
].join(" ");
