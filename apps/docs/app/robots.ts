// Crawl rules + sitemap pointer; disallows the non-HTML machine endpoints.
import type { MetadataRoute } from "next";

import { baseURL } from "@/lib/shared";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/og/",
        "/llms.txt",
        "/llms-full.txt",
        "/llms.mdx/",
        "/.well-known/agent-skills/",
      ],
    },
    sitemap: `${baseURL}/sitemap.xml`,
  };
}
