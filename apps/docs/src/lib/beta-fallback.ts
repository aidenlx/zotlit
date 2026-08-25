// The Pre-release Docs fallback for a changelog version this build never
// published.
//
// A pre-release build carries a version whose release notes only ever ship on
// Pre-release Docs, so the production line hands those URLs on instead of
// answering 404. Three surfaces share the fallback — the page, its OG card, and
// its Markdown edition — and each passes its own path, so the reader lands on
// the same kind of resource on the other line.
//
// Server-only: the gate is a Worker environment variable, `DOCS_LINE`.

import { env } from "cloudflare:workers";

import { zotlitBetaUrl } from "./shared.ts";

/**
 * Pre-release Docs' copy of `path`, or undefined when this deployment is
 * Pre-release Docs itself — the beta line owns every version it publishes, so
 * an unknown one there is a plain 404 rather than a redirect to itself.
 */
export function betaFallbackUrl(path: string): string | undefined {
  if (env.DOCS_LINE === "beta") return undefined;
  return `${zotlitBetaUrl}${path}`;
}

/**
 * The response a machine route answers with when the version is unknown: a
 * temporary redirect to Pre-release Docs, or 404 on the beta line itself.
 */
export function betaFallbackResponse(path: string): Response {
  const location = betaFallbackUrl(path);
  return location === undefined
    ? new Response("Not found", { status: 404 })
    : new Response(null, { status: 307, headers: { location } });
}
