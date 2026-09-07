import { createFileRoute } from "@tanstack/react-router";
// `/changelog/rss.xml`: the changelog feed, at the current URL.
import { Feed } from "feed";

import { baseURL, changelogRoute } from "@/lib/shared";
import { getChangelogPages } from "@/lib/source";
import { m } from "@/paraglide/messages.js";

function renderFeed(): string {
  const feed = new Feed({
    title: m.docs_changelog_og_alt(),
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
