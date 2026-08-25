// The Markdown surface's one page route: `/llms.mdx/<section>/<…>/content.md`.
//
// The splat carries the whole tail, so this route answers for all three
// sections, for a section's landing edition (`/llms.mdx/changelog/content.md`),
// and — through the router's `.md` suffix rewrite — for every `.md` suffix
// edition as well.

import { createFileRoute } from "@tanstack/react-router";

import {
  getMarkdownEdition,
  markdownHeaders,
} from "@/lib/markdown-editions.ts";
import { parseContentRoute } from "@/lib/markdown-routes.ts";

export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const page = parseContentRoute(params._splat ?? "");
        const edition = page && (await getMarkdownEdition(page));
        if (edition === undefined) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(edition, { headers: markdownHeaders });
      },
    },
  },
});
