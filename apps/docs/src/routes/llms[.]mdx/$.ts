// The Markdown surface's one page route: `/llms.mdx/<section>/<…>/content.md`.
//
// The splat carries the whole tail, so this route answers for all three
// sections, for a section's landing edition (`/llms.mdx/changelog/content.md`),
// and — through the router's `.md` suffix rewrite — for every `.md` suffix
// edition as well.

import { createFileRoute } from "@tanstack/react-router";

import { missingReleaseResponse } from "@/lib/beta-fallback";
import { getMarkdownEdition, markdownHeaders } from "@/lib/markdown-editions";
import { contentRouteUrl, parseContentRoute } from "@/lib/markdown-routes";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";

export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const locale = getLocale();
        const page = parseContentRoute(params._splat ?? "");
        const edition = page && (await getMarkdownEdition(page, { locale }));
        if (edition === undefined) {
          // A changelog version this build never published moves on.
          if (page?.section !== "changelog" || page.slugs.length === 0) {
            return new Response("Not found", { status: 404 });
          }
          return missingReleaseResponse(page.slugs.join("/"), {
            release: localizeHref(contentRouteUrl(page), { locale }),
            changelog: localizeHref(
              contentRouteUrl({ section: "changelog", slugs: [] }),
              { locale },
            ),
          });
        }

        return new Response(edition, { headers: markdownHeaders });
      },
    },
  },
});
