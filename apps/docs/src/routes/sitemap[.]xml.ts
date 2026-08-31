// `sitemap.xml`: every indexable page URL, at the current URL.

import { createFileRoute } from "@tanstack/react-router";

import { renderSitemap, xmlHeaders } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => new Response(renderSitemap(), { headers: xmlHeaders }),
    },
  },
});
