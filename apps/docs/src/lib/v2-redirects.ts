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
//     permalink lands on moves, edit that `PAGE_MAP` value in v1-routes.ts to the
//     new URL instead, so a v1 link takes one hop rather than two.
//
// Anchors do not travel with a redirect: the server never sees the `#fragment`,
// and the browser reapplies it to the destination. A section that moves to
// another page keeps its heading id there, so `old#slug` lands on `new#slug`.
//
// Every move is a permanent 308. This table redirects the HTML path only, not
// the page's Markdown editions (`<page>.md`, `/llms.mdx/docs/…/content.md`).

import type { RedirectRule } from "./v1-redirects.js";

/** Moved v2 docs page: old `/docs/...` path → new `/docs/...` path. */
export const V2_MOVES: Record<string, string> = {};

/** One permanent redirect per moved page, in the table's order. */
export function buildV2Redirects(moves = V2_MOVES): RedirectRule[] {
  return Object.entries(moves).map(([source, destination]) => ({
    source,
    destination,
    status: 308,
  }));
}
