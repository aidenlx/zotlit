// `/changelog/rss.xml`: the changelog feed, at the current URL.

import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "feed";

import { baseURL, changelogRoute } from "@/lib/shared.ts";
import { getChangelogPages } from "@/lib/source.ts";

function renderFeed(): string {
  const feed = new Feed({
    title: "ZotLit Changelog",
    id: `${baseURL}${changelogRoute}`,
    link: `${baseURL}${changelogRoute}`,
    language: "en",
  });

  for (const page of getChangelogPages()) {
    feed.addItem({
      id: page.url,
      title: `ZotLit ${page.data.version}`,
      description: page.data.description,
      link: `${baseURL}${page.url}`,
      // The collections normalize the publication day to its ISO form, which
      // parses as a UTC instant; `feed` formats it back to RFC 822.
      date: new Date(`${page.data.date}T00:00:00Z`),
    });
  }

  return feed.rss2();
}

export const Route = createFileRoute("/changelog/rss.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(renderFeed(), {
          headers: { "content-type": "application/rss+xml; charset=utf-8" },
        }),
    },
  },
});
