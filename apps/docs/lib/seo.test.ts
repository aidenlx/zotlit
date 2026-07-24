import { describe, expect, it } from "vitest";

import { pageMetadata } from "./seo";
import { ogImageUrl } from "./shared";

const fixedPublishedTime = "2026-01-02T00:00:00.000Z";

describe("seo", () => {
  it("builds a website-type page's metadata", () => {
    expect(
      pageMetadata({
        ogTitle: "Blog",
        title: "Blog",
        description: "Notes from building ZotLit.",
        path: "/blog",
        card: { type: "blog", alt: "ZotLit Blog" },
      }),
    ).toMatchSnapshot();
  });

  it("builds an article-type page's metadata", () => {
    expect(
      pageMetadata({
        ogTitle: "Building ZotLit",
        title: "Building ZotLit",
        description: "How ZotLit came to be.",
        path: "/blog/building-zotlit",
        card: {
          type: "blog",
          ids: ["building-zotlit"],
          alt: "Building ZotLit — ZotLit blog",
        },
        article: {
          publishedTime: fixedPublishedTime,
          authors: ["aidenlx"],
        },
      }),
    ).toMatchSnapshot();
  });

  it("sets openGraph.type to website when article is absent", () => {
    const result = pageMetadata({
      ogTitle: "Blog",
      description: "Notes from building ZotLit.",
      path: "/blog",
      card: { type: "blog", alt: "ZotLit Blog" },
    });

    expect(result.openGraph).toMatchObject({ type: "website" });
  });

  it("sets openGraph.type to article and includes publishedTime/authors when article is present", () => {
    const result = pageMetadata({
      ogTitle: "Building ZotLit",
      description: "How ZotLit came to be.",
      path: "/blog/building-zotlit",
      card: { type: "blog", ids: ["building-zotlit"], alt: "Building ZotLit" },
      article: {
        publishedTime: fixedPublishedTime,
        authors: ["aidenlx"],
      },
    });

    expect(result.openGraph).toMatchObject({
      type: "article",
      publishedTime: fixedPublishedTime,
      authors: ["aidenlx"],
    });
  });

  it("sets twitter card fields", () => {
    const result = pageMetadata({
      ogTitle: "Blog",
      description: "Notes from building ZotLit.",
      path: "/blog",
      card: { type: "blog", alt: "ZotLit Blog" },
    });

    expect(result.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Blog",
    });
    expect(result.twitter?.images).toBeTruthy();
  });

  it("builds og:image with fixed dimensions, type, alt, and expected url", () => {
    const result = pageMetadata({
      ogTitle: "Changelog",
      description: "Every ZotLit release, newest first.",
      path: "/changelog",
      card: { type: "changelog", ids: ["1.2.3"], alt: "ZotLit v1.2.3" },
    });

    const { images } = result.openGraph ?? {};
    const image = Array.isArray(images) ? images[0] : images;

    expect(image).toMatchObject({
      url: ogImageUrl("changelog", "1.2.3"),
      width: 1200,
      height: 630,
      type: "image/webp",
      alt: "ZotLit v1.2.3",
    });
  });

  it("omits the title key when title is not provided", () => {
    const result = pageMetadata({
      ogTitle: "ZotLit",
      description: "ZotLit brings your Zotero library into Obsidian.",
      path: "/",
      card: { type: "home", alt: "ZotLit — Zotero × Obsidian" },
    });

    expect(Object.hasOwn(result, "title")).toBe(false);
  });

  it("includes the title key when title is provided", () => {
    const result = pageMetadata({
      ogTitle: "Blog",
      title: "Blog",
      description: "Notes from building ZotLit.",
      path: "/blog",
      card: { type: "blog", alt: "ZotLit Blog" },
    });

    expect(Object.hasOwn(result, "title")).toBe(true);
    expect(result.title).toBe("Blog");
  });

  it("sets alternates.canonical to path", () => {
    const result = pageMetadata({
      ogTitle: "Blog",
      description: "Notes from building ZotLit.",
      path: "/blog",
      card: { type: "blog", alt: "ZotLit Blog" },
    });

    expect(result.alternates?.canonical).toBe("/blog");
  });

  it("only sets alternates.types when feeds is given", () => {
    const withoutFeeds = pageMetadata({
      ogTitle: "Blog",
      description: "Notes from building ZotLit.",
      path: "/blog",
      card: { type: "blog", alt: "ZotLit Blog" },
    });

    expect(withoutFeeds.alternates?.types).toBeUndefined();

    const withFeeds = pageMetadata({
      ogTitle: "Changelog",
      description: "Every ZotLit release, newest first.",
      path: "/changelog",
      card: { type: "changelog", alt: "ZotLit Changelog" },
      feeds: { "application/rss+xml": "/changelog/rss.xml" },
    });

    expect(withFeeds.alternates?.types).toEqual({
      "application/rss+xml": "/changelog/rss.xml",
    });
  });
});
