// Discovery seam for the content pipeline: the three collections compile
// through `fumadocs-mdx/vite` and reach the fumadocs loaders.

import { describe, expect, it } from "vitest";

import { getBlogPages, getChangelogPages, source } from "./source.ts";

describe("docs collection", () => {
  it("loads every page but the `_` partials", () => {
    const pages = source.getPages();
    // 54 `.mdx` files under content/docs, four of them `_`-prefixed partials
    // that reach a page through `<include>` instead of standing on their own.
    expect(pages).toHaveLength(50);
    expect(pages.map((page) => page.url)).not.toContain(
      expect.stringContaining("/_"),
    );
  });

  it("carries the page tree", () => {
    expect(source.pageTree.children.length).toBeGreaterThan(0);
  });
});

describe("changelog collection", () => {
  it("loads every entry newest-first", () => {
    const pages = getChangelogPages();
    expect(pages).toHaveLength(12);
    expect(pages.map((page) => page.data.version)).toEqual([
      "2.1.0",
      "2.1.0-beta.3",
      "2.1.0-beta.2",
      "2.1.0-beta.1",
      "2.1.0-beta.0",
      "2.0.1",
      "2.0.0",
      "2.0.0-beta.4",
      "2.0.0-beta.3",
      "2.0.0-beta.2",
      "2.0.0-beta.1",
      "2.0.0-beta.0",
    ]);
  });

  it("normalizes the frontmatter date to an ISO day", () => {
    // `2.0.0-beta.0` writes its date unquoted, so YAML hands the schema a
    // `Date` rather than a string.
    const entry = getChangelogPages().at(-1);
    expect(entry?.data.date).toBe("2026-07-22");
  });
});

describe("blog collection", () => {
  it("loads every post newest-first", () => {
    const pages = getBlogPages();
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.data.date)).toEqual([
      "2026-08-24",
      "2026-08-05",
      "2026-07-25",
    ]);
  });

  it("defaults the author", () => {
    expect(getBlogPages()[0]?.data.author).toBe("aidenlx");
  });
});
