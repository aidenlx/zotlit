// In-site redirect table: a v2 docs page that moved to a new URL. The v1
// permalink table is lib/v1-redirects.ts; lib/redirects.ts puts both into the
// one `_redirects` file that `vite.config.ts` emits.
//
// ── Adding an entry ─────────────────────────────────────────────────────
// One line per moved page, old path → new path. The old path is a `/docs/...`
// path; the new one is a `/docs/...` or a `/learn...` path, for a page that
// became a lesson. Both are root-relative, with no trailing slash, query, or
// `#fragment`:
//
//   "/docs/how-to/use-library-view": "/docs/organize/use-library-view",
//   "/docs/tutorial/first-note": "/learn/connect-zotero-to-obsidian",
//
// Rules the tests in v2-redirects.test.ts enforce:
//   - The destination is a live page in content/docs, a lesson in
//     content/learn, or the `/learn` course page.
//   - No chains: a destination is never another entry's source, nor a v1 source.
//     When a page moves twice, point the first entry straight at the final URL.
//   - A v1 `PAGE_MAP` destination is never a source here. When a page a v1
//     permalink lands on moves, change that `PAGE_MAP` value in v1-routes.ts to
//     the new URL too, then add the entry here; the entry fails the tests until
//     `PAGE_MAP` no longer names the old URL, so a v1 link takes one hop.
//
// Anchors do not travel with a redirect: the server never sees the `#fragment`,
// and the browser reapplies it to the destination. A section that moves to
// another page keeps its heading id there, so `old#slug` lands on `new#slug`.
//
// Every move is a permanent 308, and each entry also moves the page's two
// Markdown editions (`<page>.md` and `/llms.mdx/<section>/…/content.md`),
// spelled by lib/markdown-routes.ts. The `/zh-CN` copies of all three move the
// same way, whether the page has a Chinese file or falls back to English. OG
// card URLs are not redirected: only a live page ever links its card.

import { i18n, localizedPath } from "./i18n.js";
import { contentRouteUrl, suffixEditionUrl } from "./markdown-routes.js";
import type { MarkdownPage, MarkdownSection } from "./markdown-routes.js";
import type { RedirectRule } from "./v1-redirects.js";

/** Moved v2 docs page: old `/docs/...` path → new `/docs/...` or `/learn...` path. */
export const V2_MOVES: Record<string, string> = {
  // The tutorial section became the `/learn` course (Lessons 1 and 3) and two how-to guides.
  "/docs/tutorial": "/learn",
  "/docs/tutorial/first-note": "/learn/connect-zotero-to-obsidian",
  "/docs/tutorial/write-and-export-cited-note":
    "/learn/cite-in-obsidian-with-zotero",
  "/docs/tutorial/pandoc-citation-workflow":
    "/docs/how-to/pandoc-citation-workflow",
  "/docs/tutorial/customize-template": "/docs/how-to/customize-template",
};

/** The sections a moved page can land in. */
const destinationSections: MarkdownSection[] = ["docs", "learn"];

/** The page a path addresses in one of `sections`. */
function pageOf(path: string, sections: MarkdownSection[]): MarkdownPage {
  const [section, ...slugs] = path.split("/").filter(Boolean);
  const found = sections.find((candidate) => candidate === section);
  if (!found) throw new Error(`${path} is not a ${sections.join(" or ")} path`);
  return { section: found, slugs };
}

/**
 * Three permanent redirects per moved page and locale, in the table's order:
 * the page, then its suffix edition, then its content route.
 */
export function buildV2Redirects(moves = V2_MOVES): RedirectRule[] {
  return Object.entries(moves).flatMap(([from, to]) => {
    const [old, moved] = [
      pageOf(from, ["docs"]),
      pageOf(to, destinationSections),
    ];
    const pairs = [
      { source: from, destination: to },
      { source: suffixEditionUrl(old), destination: suffixEditionUrl(moved) },
      { source: contentRouteUrl(old), destination: contentRouteUrl(moved) },
    ];
    return i18n.languages.flatMap((locale) =>
      pairs.map(({ source, destination }): RedirectRule => ({
        source: localizedPath(source, locale),
        destination: localizedPath(destination, locale),
        status: 308,
      })),
    );
  });
}
