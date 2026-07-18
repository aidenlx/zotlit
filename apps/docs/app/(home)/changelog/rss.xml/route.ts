import { Feed } from "feed";
import { NextResponse } from "next/server";

import { baseURL } from "@/lib/shared";
import { getChangelogPages } from "@/lib/source";

export const revalidate = false;

export function GET() {
  const feed = new Feed({
    title: "ZotLit Changelog",
    id: `${baseURL}/changelog`,
    link: `${baseURL}/changelog`,
    language: "en",
  });

  for (const page of getChangelogPages()) {
    feed.addItem({
      id: page.url,
      title: `ZotLit ${page.data.version}`,
      description: page.data.description,
      link: `${baseURL}${page.url}`,
      date: page.data.date,
    });
  }

  return new NextResponse(feed.rss2(), {
    headers: {
      "Content-Type": "application/rss+xml",
    },
  });
}
