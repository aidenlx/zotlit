// Full-text search over the docs collection, served live by the SSR Worker.
//
// A route file whose only `createFileRoute` property is `server` is pruned from
// the client route tree, so this endpoint is server-rendered on every request
// and never becomes a prerendered asset.

import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

/**
 * Only the docs loader is indexed; the changelog and the blog stay out of
 * search, matching the Next.js site. The index builds on the first query and
 * then lives for the isolate's lifetime.
 *
 * @see https://github.com/fuma-nama/fumadocs/blob/fumadocs-mdx%4015.2.1/apps/docs/content/docs/headless/search/index.mdx
 */
const searchApi = createFromSource(source, {
  language: "english",
});

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => searchApi.GET(request),
    },
  },
});
