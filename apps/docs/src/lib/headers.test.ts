import { describe, expect, it } from "vitest";

import { renderHeadersFile } from "./headers";

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

  it("keeps the hashed chunks out of the search index", () => {
    expect(file).toContain("/assets/*\n  X-Robots-Tag: noindex");
  });
});
