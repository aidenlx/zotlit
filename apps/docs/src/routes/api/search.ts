// Full-text search over the docs collection, served live by the SSR Worker.
//
// A route file whose only `createFileRoute` property is `server` is pruned from
// the client route tree, so this endpoint is server-rendered on every request
// and never becomes a prerendered asset.

import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { isSiteLocale } from "@/lib/i18n";
import { source } from "@/lib/source";

/**
 * Only the docs loader is indexed; the changelog and the blog stay out of
 * search, matching the Next.js site. The index builds on the first query and
 * then lives for the isolate's lifetime. It sets no `language`: the default
 * multilingual tokenizer segments Chinese with `Intl.Segmenter`, while
 * `"english"` would drop CJK text from both the index and the query.
 *
 * @see https://github.com/fuma-nama/fumadocs/blob/fumadocs-mdx%4015.2.1/apps/docs/content/docs/headless/search/index.mdx
 */
const searchApi = createFromSource(source);

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const locale = new URL(request.url).searchParams.get("locale");
        if (locale !== null && !isSiteLocale(locale)) {
          return Response.json(
            { error: "Unsupported locale" },
            { status: 400 },
          );
        }
        return searchApi.GET(request);
      },
    },
  },
});
