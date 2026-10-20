// In-site redirect table: a v2 docs page that moved to a new URL. The v1
// permalink table is lib/v1-redirects.ts; lib/redirects.ts puts both into the
// one `_redirects` file that `vite.config.ts` emits.
//
// ── Adding an entry ─────────────────────────────────────────────────────
// One line per moved page, old path → new path, both root-relative `/docs/...`
// paths with no trailing slash, query, or `#fragment`:
//
//   "/docs/how-to/use-library-view": "/docs/organize/use-library-view",
//
// Rules the tests in v2-redirects.test.ts enforce:
//   - The destination is a live page in content/docs.
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
// Markdown editions (`<page>.md` and `/llms.mdx/docs/…/content.md`), spelled by
// lib/markdown-routes.ts. OG card URLs are not redirected: only a live page
// ever links its card.

import { contentRouteUrl, suffixEditionUrl } from "./markdown-routes.js";
import type { MarkdownPage } from "./markdown-routes.js";
import type { RedirectRule } from "./v1-redirects.js";

/** Moved v2 docs page: old `/docs/...` path → new `/docs/...` path. */
export const V2_MOVES: Record<string, string> = {};

/** The docs page a `/docs/...` path addresses. */
function docsPage(path: string): MarkdownPage {
  const [section, ...slugs] = path.split("/").filter(Boolean);
  if (section !== "docs") throw new Error(`${path} is not a /docs path`);
  return { section, slugs };
}

/**
 * Three permanent redirects per moved page, in the table's order: the page,
 * then its suffix edition, then its content route.
 */
export function buildV2Redirects(moves = V2_MOVES): RedirectRule[] {
  return Object.entries(moves).flatMap(([from, to]) => {
    const [old, moved] = [docsPage(from), docsPage(to)];
    return [
      { source: from, destination: to },
      { source: suffixEditionUrl(old), destination: suffixEditionUrl(moved) },
      { source: contentRouteUrl(old), destination: contentRouteUrl(moved) },
    ].map((rule): RedirectRule => ({ ...rule, status: 308 }));
  });
}
