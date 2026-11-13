import { describe, expect, it } from "vitest";

import { buildHeaderRules, renderHeadersFile } from "./headers";

describe("renderHeadersFile", () => {
  const file = renderHeadersFile();

  it("adds the giscus CORS header to the comment themes", () => {
    expect(file).toContain(
      "/giscus/*\n  Access-Control-Allow-Origin: https://giscus.app",
    );
  });

  it("types the changelog feed as RSS", () => {
    expect(file).toContain(
      "/changelog/rss.xml\n  Content-Type: application/rss+xml; charset=utf-8",
    );
  });

  it("caches the commit-pinned agent-skill archives forever", () => {
    expect(file).toContain(
      "/.well-known/agent-skills/*/archive.zip\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("caches the hashed chunks forever and keeps them out of the search index", () => {
    expect(file).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Robots-Tag: noindex",
    );
  });
});

// The asset layer answers these Markdown editions without the Worker, so the
// `_headers` file alone can keep them out of the index and point a crawler at
// the HTML page. A Cloudflare placeholder matches one path segment.
describe("Markdown edition rules", () => {
  const rules = buildHeaderRules([
    "/llms.mdx/docs/content.md",
    "/llms.mdx/docs/how-to/insert-citations/content.md",
    "/llms.mdx/blog/v2-release/content.md",
    "/zh-CN/llms.mdx/docs/reference/commands/content.md",
    "/docs.md",
    "/docs/how-to/insert-citations.md",
    "/docs/how-to/insert-citations",
  ]);
  const bySource = new Map(rules.map((rule) => [rule.source, rule.headers]));

  it.each([
    ["/llms.mdx/:p1/content.md", "https://zotlit.aidenlx.site/:p1"],
    [
      "/llms.mdx/:p1/:p2/:p3/content.md",
      "https://zotlit.aidenlx.site/:p1/:p2/:p3",
    ],
    ["/llms.mdx/:p1/:p2/content.md", "https://zotlit.aidenlx.site/:p1/:p2"],
    [
      "/zh-CN/llms.mdx/:p1/:p2/:p3/content.md",
      "https://zotlit.aidenlx.site/zh-CN/:p1/:p2/:p3",
    ],
    ["/docs.md", "https://zotlit.aidenlx.site/docs"],
  ])("keeps %s out of the index, canonical to %s", (source, page) => {
    expect(bySource.get(source)).toEqual({
      "X-Robots-Tag": "noindex",
      Link: `<${page}>; rel="canonical"`,
    });
  });

  it("leaves the editions the Worker answers to the Worker", () => {
    expect(rules.map((rule) => rule.source)).not.toContain(
      "/docs/how-to/insert-citations.md",
    );
    expect(rules).toHaveLength(buildHeaderRules().length + 5);
  });
});
