// `robots.txt`: crawl rules plus the sitemap pointer, at the current URL.

import { createFileRoute } from "@tanstack/react-router";

import { plainTextHeaders } from "@/lib/markdown-editions.ts";
import { baseURL } from "@/lib/shared.ts";

/**
 * Everything a reader sees is crawlable; the machine endpoints are not. They
 * publish the same content in agent-facing form, so indexing them would only
 * duplicate the HTML pages in the results.
 */
const disallow = [
  "/api/",
  "/og/",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/",
  "/.well-known/agent-skills/",
];

const robots = `User-Agent: *
Allow: /
${disallow.map((path) => `Disallow: ${path}`).join("\n")}

Sitemap: ${baseURL}/sitemap.xml
`;

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => new Response(robots, { headers: plainTextHeaders }),
    },
  },
});
