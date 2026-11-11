import { describe, expect, it } from "vitest";

import { paraglideMiddleware } from "@/paraglide/server.js";

import { pageHead } from "./seo";

/** `pageHead` for an English page, as a request for it would build it. */
async function headFor(
  seo: Omit<Parameters<typeof pageHead>[0], "path" | "card">,
) {
  let head: ReturnType<typeof pageHead> | undefined;
  await paraglideMiddleware(
    new Request("https://zotlit.aidenlx.site/docs/fixture"),
    () => {
      head = pageHead({
        ...seo,
        path: "/docs/fixture",
        card: { type: "docs", alt: "" },
      });
      return new Response();
    },
  );
  return head!;
}

describe("pageHead titles", () => {
  it("suffixes a page title with the site name and keeps og:title bare", async () => {
    const { meta } = await headFor({ title: "Cite Zotero sources" });
    expect(meta).toContainEqual({ title: "Cite Zotero sources | ZotLit" });
    expect(meta).toContainEqual({
      property: "og:title",
      content: "Cite Zotero sources",
    });
  });

  it("uses a full title as written, for both the document and og:title", async () => {
    const fullTitle = "ZotLit: Zotero integration for Obsidian";
    const { meta } = await headFor({ fullTitle, title: "Ignored" });
    expect(meta).toContainEqual({ title: fullTitle });
    expect(meta).toContainEqual({ property: "og:title", content: fullTitle });
    expect(meta).toContainEqual({ name: "twitter:title", content: fullTitle });
  });

  it("falls back to the bare site name", async () => {
    const { meta } = await headFor({});
    expect(meta).toContainEqual({ title: "ZotLit" });
    expect(meta).toContainEqual({ property: "og:title", content: "ZotLit" });
  });
});
