// The Markdown surface's one page route: `/llms.mdx/<section>/<…>/content.md`.
//
// The splat carries the whole tail, so this route answers for all three
// sections, for a section's landing edition (`/llms.mdx/changelog/content.md`),
// and — through the router's `.md` suffix rewrite — for every `.md` suffix
// edition as well.

import { createFileRoute } from "@tanstack/react-router";

import { betaFallbackResponse } from "@/lib/beta-fallback";
import { getMarkdownEdition, markdownHeaders } from "@/lib/markdown-editions";
import { contentRouteUrl, parseContentRoute } from "@/lib/markdown-routes";

export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const page = parseContentRoute(params._splat ?? "");
        const edition = page && (await getMarkdownEdition(page));
        if (edition === undefined) {
          // A changelog version this build never published still has an
          // edition on Pre-release Docs.
          return page?.section === "changelog" && page.slugs.length > 0
            ? betaFallbackResponse(contentRouteUrl(page))
            : new Response("Not found", { status: 404 });
        }

        return new Response(edition, { headers: markdownHeaders });
      },
    },
  },
});
