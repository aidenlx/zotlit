// `sitemap.xml`: every indexable page URL, at the current URL.

import { createFileRoute } from "@tanstack/react-router";

import { renderSitemap, xmlHeaders } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await renderSitemap(), { headers: xmlHeaders }),
    },
  },
});
