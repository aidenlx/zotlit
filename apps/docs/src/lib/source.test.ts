// Discovery seam for the content pipeline: the three collections compile
// through `fumadocs-mdx/vite` and reach the fumadocs loaders.

import { rcompare } from "semver";
import { describe, expect, it } from "vitest";

import { getBlogPages, getChangelogPages, source } from "./source";

describe("docs collection", () => {
  it("loads every page but the `_` partials", () => {
    const pages = source.getPages();
    expect(pages.length).toBeGreaterThan(0);
    // `_`-prefixed partials reach a page through `<include>` instead of
    // standing on their own, so they stay out of the collection.
    expect(pages.map((page) => page.url)).not.toContainEqual(
      expect.stringContaining("/_"),
    );
  });
});

describe("changelog collection", () => {
  it("loads every entry newest-first", () => {
    const entries = getChangelogPages().map((page) => page.data);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(
      [...entries].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || rcompare(a.version, b.version),
      ),
    );
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
    const dates = getBlogPages().map((page) => page.data.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("defaults the author", () => {
    expect(getBlogPages()[0]?.data.author).toBe("aidenlx");
  });
});
