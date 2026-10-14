// The Worker's entry point: negotiate, then the asset layer, then SSR.
//
// `run_worker_first` in `wrangler.jsonc` registers this Worker ahead of the
// static assets on the HTML page paths alone, which is the only way the Accept
// header is read before a prerendered page is served. Every other path reaches
// the Worker only after the asset layer found no file, so the lookup below is
// a cheap miss for the server-rendered routes.
//
// @see docs/adr/0051-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";

import { getPageLocaleState } from "./lib/locale-state";
import { negotiatedContentRoute } from "./lib/markdown-routes";
import { buildV1Redirects } from "./lib/v1-redirects";
import { deLocalizeUrl } from "./paraglide/runtime.js";
import { paraglideMiddleware } from "./paraglide/server";

/**
 * The request as the rest of the site should see it. An agent that prefers
 * Markdown is pointed at the page's authored edition; a path that publishes no
 * edition drops the preference instead, so the page answers as the HTML it is —
 * the renderer serves a document route to HTML readers alone.
 */
function negotiate(request: Request, locale: string): Request {
  if (!isMarkdownPreferred(request)) return request;

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const contentRoute = negotiatedContentRoute(deLocalizeUrl(url).pathname);
  if (contentRoute)
    url.pathname = `${locale === "zh-CN" ? "/zh-CN" : ""}${contentRoute}`;
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

const globalMachinePaths = new Set([
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.xml",
  "/robots.txt",
  "/changelog/rss.xml",
]);

const legacyPaths = new Set(buildV1Redirects().map((rule) => rule.source));

export default createServerEntry({
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const unprefixedPath = deLocalizeUrl(url).pathname;
    const machinePath = unprefixedPath.replace(/\/+$/, "");
    // Global inventories publish one English edition; do not render them under
    // a Chinese request context.
    // Unprefixed slash variants still render while prerender creates the assets.
    if (
      pathname.replace(/\/+$/, "") !== machinePath &&
      globalMachinePaths.has(machinePath)
    ) {
      url.pathname = machinePath;
      return Response.redirect(url, 308);
    }
    // Legacy slash aliases must resolve before locale normalization, in one hop.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      legacyPaths.has(pathname)
    ) {
      const legacy = await servedAsset(request);
      if (legacy) return legacy;
    }
    return paraglideMiddleware(request, async ({ locale }) => {
      if (request.method !== "GET" && request.method !== "HEAD")
        return handler.fetch(request);
      const forwarded = negotiate(request, locale);
      const response =
        (await servedAsset(forwarded)) ?? (await handler.fetch(forwarded));
      const state = getPageLocaleState(pathname, locale);
      const headers = new Headers(response.headers);
      headers.set("content-language", state.contentLocale);
      if (state.isFallback) headers.set("x-robots-tag", "noindex, follow");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  },
});
