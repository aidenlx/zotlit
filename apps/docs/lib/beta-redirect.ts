import { notFound, redirect } from "next/navigation";

import { isProductionDeployment, zotlitBetaUrl } from "@/lib/shared";

/**
 * 307s to the beta site's copy of `path` on the production deployment;
 * 404s elsewhere. `path` is the current site's local path (e.g.
 * `/changelog/1.0.0` or `/og/changelog/1.0.0/image.webp`) — versions this
 * site never published (pre-release/beta builds) still live on the beta
 * site, so unresolved changelog lookups fall through here instead of 404ing
 * on production.
 */
export function notFoundOrBetaRedirect(path: string): never {
  if (isProductionDeployment) {
    redirect(`${zotlitBetaUrl}${path}`);
  }
  notFound();
}
