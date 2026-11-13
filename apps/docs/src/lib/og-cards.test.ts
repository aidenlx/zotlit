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
});
