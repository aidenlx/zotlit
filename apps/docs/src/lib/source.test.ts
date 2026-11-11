// Discovery seam for the content pipeline: the three collections compile
// through `fumadocs-mdx/vite` and reach the fumadocs loaders.

import { rcompare } from "semver";
import { describe, expect, it } from "vitest";

import { docsPageTitle } from "./shared";
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

  // A search result shows about 60 characters of title and 160 of
  // description; two pages with one title compete for the same query.
  it("titles each page once, within search-result limits", () => {
    const pages = source.getPages("en").map((page) => ({
      url: page.url,
      title: docsPageTitle(page.data),
      description: page.data.description ?? "",
    }));
    expect(pages.filter(({ title }) => title.length > 60)).toEqual([]);
    expect(pages.filter(({ description }) => description.length > 160)).toEqual(
      [],
    );
    const titles = pages.map(({ title }) => title.toLowerCase());
    expect(titles.filter((title, i) => titles.indexOf(title) !== i)).toEqual(
      [],
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
});

describe("blog collection", () => {
  it("loads every post newest-first", () => {
    const dates = getBlogPages().map((page) => page.data.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
