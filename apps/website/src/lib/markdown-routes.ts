// The URL scheme of the Markdown surface, as a pure module.
//
// Every page publishes its authored Markdown at two URLs: the `.md` suffix
// edition at the page's own URL, and the parallel content route under
// `/llms.mdx`. One route answers both — `rewriteMarkdownSuffix` folds the
// suffix edition onto the content route before the router matches, the way
// the Next.js site's proxy rewrote it.
//
// Three callers share this scheme, which is why it lives apart from the
// editions themselves: the router (client and server), the `/llms.mdx` route
// handler, and the build's prerender list.

/** The content sections that publish a Markdown edition. */
export const markdownSections = ["docs", "changelog", "blog"] as const;

export type MarkdownSection = (typeof markdownSections)[number];

/** The page a content route addresses. Empty `slugs` is the section itself. */
export interface MarkdownPage {
  section: MarkdownSection;
  slugs: string[];
}

/** The tail segment that ends every content route. */
const contentFile = "content.md";

const suffix = ".md";

function isMarkdownSection(value: string): value is MarkdownSection {
  return (markdownSections as readonly string[]).includes(value);
}

/** `/docs/how-to/insert-citations.md` — the page's own URL plus `.md`. */
export function suffixEditionUrl({ section, slugs }: MarkdownPage) {
  return `/${[section, ...slugs].join("/")}${suffix}`;
}

/** `/llms.mdx/docs/how-to/insert-citations/content.md` — the content route. */
export function contentRouteUrl({ section, slugs }: MarkdownPage) {
  return `/llms.mdx/${[section, ...slugs, contentFile].join("/")}`;
}

/** The page a content route's splat addresses, or undefined for any other tail. */
export function parseContentRoute(splat: string): MarkdownPage | undefined {
  const segments = splat.split("/").filter(Boolean);
  if (segments.pop() !== contentFile) return undefined;

  const [section, ...slugs] = segments;
  if (section === undefined || !isMarkdownSection(section)) return undefined;

  return { section, slugs };
}

/**
 * Folds a `.md` suffix edition onto its content route, so both URLs reach the
 * same handler. Any other URL passes through untouched.
 */
export function rewriteMarkdownSuffix(url: URL) {
  const { pathname } = url;
  if (!pathname.endsWith(suffix)) return url;

  const page = pathname.slice(1, -suffix.length);
  const [section, ...slugs] = page.split("/");
  if (section === undefined || !isMarkdownSection(section)) return url;

  url.pathname = contentRouteUrl({ section, slugs });
  return url;
}
