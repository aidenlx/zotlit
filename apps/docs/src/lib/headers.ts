// The `_headers` table for the Cloudflare asset layer. `vite.config.ts` emits
// the rendered file into the client build so the asset layer applies these
// headers without a Worker invocation.

/** One `_headers` block: a path pattern and the headers it adds. */
export interface HeaderRule {
  source: string;
  headers: Record<string, string>;
}

export function buildHeaderRules(): HeaderRule[] {
  return [
    /**
     * giscus loads the custom comment themes (public/giscus/*.css) into its
     * cross-origin iframe via `<link crossorigin="anonymous">`, so they must
     * send an Access-Control-Allow-Origin header or the browser blocks the
     * stylesheet.
     */
    {
      source: "/giscus/*",
      headers: { "Access-Control-Allow-Origin": "https://giscus.app" },
    },
    // The asset layer types a prerendered `.xml` file as generic XML; feed
    // readers expect the RSS media type the Next.js site served.
    {
      source: "/changelog/rss.xml",
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    },
    // Every archive URL is pinned to the commit it was built from, so its
    // bytes never change.
    {
      source: "/.well-known/agent-skills/*/archive.zip",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    /**
     * Every file under `/assets/` carries a content hash in its name, so a
     * changed build ships a new URL and these bytes never change. The asset
     * layer otherwise defaults to `public, max-age=0, must-revalidate`, which
     * costs a revalidation round trip per chunk, font, and stylesheet on every
     * repeat visit.
     *
     * Googlebot fetches the hashed chunks to render a page, so they stay
     * crawlable; the header alone keeps them out of the index. A `robots.txt`
     * rule here would block rendering instead.
     */
    {
      source: "/assets/*",
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Robots-Tag": "noindex",
      },
    },
  ];
}

/** @see https://developers.cloudflare.com/workers/static-assets/headers/ */
export function renderHeadersFile(rules = buildHeaderRules()): string {
  const blocks = rules.map(({ source, headers }) =>
    [
      source,
      ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    ].join("\n"),
  );
  return `${blocks.join("\n\n")}\n`;
}
