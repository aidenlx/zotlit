import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { scanContent } from "./content-scan";
import { ogCards } from "./og-cards";
import { docsPageTitle, ogImageUrl } from "./shared";

const frontmatter = v.object({
  title: v.string(),
  searchTitle: v.optional(v.string()),
});

describe("docs OG cards", () => {
  it("title each card with the page's own title", async () => {
    const packageRoot = getPackageRoot(import.meta.filename);
    const cards = await ogCards(packageRoot);
    const pages = scanContent(packageRoot).docs.map((page) => ({
      url: ogImageUrl("docs", page.slugs),
      data: v.parse(frontmatter, page.frontmatter),
    }));
    expect(pages.some(({ data }) => data.searchTitle !== undefined)).toBe(true);
    for (const { url, data } of pages) {
      expect(cards.get(url)?.title, url).toBe(docsPageTitle(data));
    }
  });

  // A native Chinese page advertises its own card; a page with no Chinese
  // file falls back to the English card, so the build renders no zh one.
  it("give each Chinese edition a card with its own title", async () => {
    const packageRoot = getPackageRoot(import.meta.filename);
    const cards = await ogCards(packageRoot);
    const chinese = scanContent(packageRoot, { locale: "zh-CN" }).docs;
    expect(chinese.length).toBeGreaterThan(0);
    for (const page of chinese) {
      const url = ogImageUrl("docs", page.slugs, "zh-CN");
      const data = v.parse(frontmatter, page.frontmatter);
      expect(cards.get(url)?.title, url).toBe(docsPageTitle(data));
    }
    const native = new Set(chinese.map(({ slugs }) => slugs.join("/")));
    const english = scanContent(packageRoot).docs;
    const fallback = english.find(({ slugs }) => !native.has(slugs.join("/")));
    expect(fallback).toBeDefined();
    expect(cards.has(ogImageUrl("docs", fallback!.slugs, "zh-CN"))).toBe(false);
  });
});
