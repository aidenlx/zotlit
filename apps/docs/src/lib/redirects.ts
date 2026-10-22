// The whole `_redirects` file `vite.config.ts` emits: the v2 in-site moves
// (lib/v2-redirects.ts) ahead of the v1 permalink table (lib/v1-redirects.ts).
// The asset layer takes the first rule whose source matches. The two tables
// share no source today (v2 sources live under `/docs`, v1 sources never do),
// so the order only guards a v2 move against a future v1 wildcard.

import type { RedirectRule } from "./v1-redirects.js";
import { buildV1Redirects, renderRedirectsFile } from "./v1-redirects.js";
import { buildV2Redirects, V2_MOVES } from "./v2-redirects.js";

/** Every redirect rule, in match order. */
export function buildRedirects(moves = V2_MOVES): RedirectRule[] {
  return [...buildV2Redirects(moves), ...buildV1Redirects()];
}

/** @see https://developers.cloudflare.com/workers/static-assets/redirects/ */
export function renderSiteRedirectsFile(moves = V2_MOVES): string {
  return renderRedirectsFile(buildRedirects(moves));
}
