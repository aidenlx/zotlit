// The Worker's entry point: negotiate, then the asset layer, then SSR.
//
// `run_worker_first` in `wrangler.jsonc` registers this Worker ahead of the
// static assets on the HTML page paths alone, which is the only way the Accept
// header is read before a prerendered page is served. Every other path reaches
// the Worker only after the asset layer found no file, so the lookup below is
// a cheap miss for the server-rendered routes.
//
// @see docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";

import { negotiatedContentRoute } from "./lib/markdown-routes";

/**
 * The request as the rest of the site should see it. An agent that prefers
 * Markdown is pointed at the page's authored edition; a path that publishes no
 * edition drops the preference instead, so the page answers as the HTML it is —
 * the renderer serves a document route to HTML readers alone.
 */
function negotiate(request: Request): Request {
  if (!isMarkdownPreferred(request)) return request;

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const contentRoute = negotiatedContentRoute(url.pathname);
  if (contentRoute) url.pathname = contentRoute;
  else headers.set("accept", "text/html");

  return new Request(url, { method: request.method, headers });
}

/** The asset layer's answer, or undefined when it holds no file for the request. */
async function servedAsset(request: Request) {
  const response = await env.ASSETS.fetch(
    // `redirect: "manual"` hands a `_redirects` rule back to the reader as the
    // redirect it is. Following it here would chase a legacy v1 permalink to
    // its own destination and answer with that page instead.
    new Request(request, { redirect: "manual" }),
  );
  return response.status === 404 ? undefined : response;
}

export default createServerEntry({
  async fetch(request) {
    // Only a read is negotiated or answered from the asset layer; a server
    // function POST goes straight to the handler with its body intact.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return handler.fetch(request);
    }

    const forwarded = negotiate(request);
    // No prerendered file: render on the Worker. A negotiated path the build
    // never wrote — a changelog version published only on Pre-release Docs —
    // lands on its route handler there, which owns that fallback.
    return (await servedAsset(forwarded)) ?? (await handler.fetch(forwarded));
  },
});
