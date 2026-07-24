import { describe, expect, it } from "vitest";

import { baseURL } from "./shared";
import {
  blogPostingSchema,
  breadcrumbListSchema,
  changelogArticleSchema,
  organizationSchema,
  serializeJsonLd,
  softwareApplicationSchema,
  websiteSchema,
} from "./structured-data";

const fixedDate = new Date("2026-01-02T00:00:00.000Z");

describe("structured-data", () => {
  it("builds the website schema", () => {
    expect(websiteSchema).toMatchSnapshot();
  });

  it("builds the organization schema", () => {
    expect(organizationSchema).toMatchSnapshot();
  });

  it("builds the software application schema", () => {
    expect(softwareApplicationSchema).toMatchSnapshot();
  });

  it("keeps free pricing and desktop-only operating systems", () => {
    expect(softwareApplicationSchema.offers).toMatchObject({
      price: 0,
    });
    expect(softwareApplicationSchema.operatingSystem).toBe(
      "Windows, macOS, Linux",
    );
  });

  it("builds a representative blog posting schema", () => {
    expect(
      blogPostingSchema({
        title: "Building ZotLit",
        description: "How ZotLit came to be.",
        author: "aidenlx",
        date: fixedDate,
        url: "/blog/building-zotlit",
      }),
    ).toMatchSnapshot();
  });

  it("derives the maintainer's GitHub profile url from the author and omits description", () => {
    const schema = blogPostingSchema({
      title: "No description here",
      author: "aidenlx",
      date: fixedDate,
      url: "/blog/no-description",
    });

    expect(schema.author).toMatchObject({
      url: "https://github.com/aidenlx",
    });
    expect(schema).not.toHaveProperty("description");
  });

  it("omits the url for a non-maintainer author", () => {
    const schema = blogPostingSchema({
      title: "x",
      author: "Jane Doe",
      date: fixedDate,
      url: "/blog/x",
    });

    expect(schema.author).toEqual({ "@type": "Person", name: "Jane Doe" });
    expect(schema.author).not.toHaveProperty("url");
  });

  it("formats datePublished as ISO 8601", () => {
    const schema = blogPostingSchema({
      title: "Date check",
      author: "aidenlx",
      date: fixedDate,
      url: "/blog/date-check",
    });

    expect(schema.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("builds a representative changelog article schema", () => {
    expect(
      changelogArticleSchema({
        title: "ZotLit v1.2.3",
        version: "1.2.3",
        date: fixedDate,
        url: "/changelog/1.2.3",
      }),
    ).toMatchSnapshot();
  });

  it("falls back to the default headline when title is absent", () => {
    const schema = changelogArticleSchema({
      version: "1.2.3",
      date: fixedDate,
      url: "/changelog/1.2.3",
    });

    expect(schema.headline).toBe("ZotLit v1.2.3");
  });

  it("uses the provided title as headline when present", () => {
    const schema = changelogArticleSchema({
      title: "Custom Release Title",
      version: "1.2.3",
      date: fixedDate,
      url: "/changelog/1.2.3",
    });

    expect(schema.headline).toBe("Custom Release Title");
  });

  it("builds a representative breadcrumb list schema", () => {
    expect(
      breadcrumbListSchema([
        { name: "ZotLit", url: "/" },
        { name: "Blog", url: "/blog" },
        { name: "Building ZotLit", url: "/blog/building-zotlit" },
      ]),
    ).toMatchSnapshot();
  });

  it("assigns 1-based sequential positions and absolutizes item urls", () => {
    const schema = breadcrumbListSchema([
      { name: "ZotLit", url: "/" },
      { name: "Blog", url: "/blog" },
    ]);

    expect(schema.itemListElement).toMatchObject([
      { position: 1, item: `${baseURL}/` },
      { position: 2, item: `${baseURL}/blog` },
    ]);
  });

  it("escapes </script> payloads for safe embedding", () => {
    const serialized = serializeJsonLd(
      blogPostingSchema({
        title: "</script><script>alert(1)</script>",
        author: "aidenlx",
        date: new Date("2026-01-02"),
        url: "/blog/x",
      }),
    );

    expect(serialized).toContain("\\u003c");
    expect(serialized).not.toContain("<");
  });
});
