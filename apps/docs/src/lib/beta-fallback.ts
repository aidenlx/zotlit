// Where a changelog version this build never published goes.
//
// A pre-release build carries a version whose release notes only ever ship on
// Pre-release Docs, so the production line hands those URLs on instead of
// answering 404. A version older than the first release notes predates the
// changelog itself — the plugin links every GitHub release tag, the 2.0.0
// alphas among them — so both lines move it to the changelog for good. Three
// surfaces share the decision — the page, its OG card, and its Markdown
// edition — and each passes its own paths, so the reader lands on the same
// kind of resource.
//
// Server-only: the gate is a Worker environment variable, `DOCS_LINE`.

import { env } from "cloudflare:workers";
import { compare, lt, valid } from "semver";

import { zotlitBetaUrl } from "./shared";
import { changelog } from "./source";

/** A surface's own resource for the version, and its resource for the changelog. */
interface ReleasePaths {
  release: string;
  changelog: string;
}

/**
 * Pre-release Docs' copy of `path`, or undefined when this deployment is
 * Pre-release Docs itself — the beta line owns every version it publishes, so
 * an unknown one there is a plain 404 rather than a redirect to itself.
 */
function betaFallbackUrl(path: string): string | undefined {
  if (env.DOCS_LINE === "beta") return undefined;
  return `${zotlitBetaUrl}${path}`;
}

function predatesChangelog(version: string): boolean {
  const [first] = changelog
    .getPages("en")
    .map((page) => page.data.version)
    .toSorted(compare);
  return valid(version) !== null && first !== undefined && lt(version, first);
}

/**
 * The redirect for a version this build never published: permanent to the
 * changelog for a version older than its first release notes, temporary to
 * Pre-release Docs for any other, or undefined on the beta line itself.
 */
export function missingReleaseRedirect(
  version: string,
  paths: ReleasePaths,
): { href: string; status: 307 | 308 } | undefined {
  if (predatesChangelog(version)) return { href: paths.changelog, status: 308 };
  const href = betaFallbackUrl(paths.release);
  return href === undefined ? undefined : { href, status: 307 };
}

/** The response a machine route answers with when the version is unknown. */
export function missingReleaseResponse(
  version: string,
  paths: ReleasePaths,
): Response {
  const target = missingReleaseRedirect(version, paths);
  return target === undefined
    ? new Response("Not found", { status: 404 })
    : new Response(null, {
        status: target.status,
        headers: { location: target.href },
      });
}
