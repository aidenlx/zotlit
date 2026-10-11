import { describe, expect, it } from "vitest";

import { getPageLocaleState } from "./locale-state";

const nativeChinesePages = new Set([
  "/docs/native",
  "/blog/native",
  "/changelog/2.1.0",
]);

// Failure modes: missing files must not advertise Chinese; native files need
// reciprocal links; HTML and Markdown aliases must make the same decision.
describe("getPageLocaleState", () => {
  it.each(["/docs", "/docs/pending", "/docs/missing"])(
    "keeps a missing Chinese page on its English canonical: %s",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", nativeChinesePages)).toEqual({
        contentLocale: "en",
        isFallback: true,
        canonicalPath: path,
        alternates: [
          { locale: "en", path },
          { locale: "x-default", path },
        ],
      });
      expect(getPageLocaleState(path, "en", nativeChinesePages)).toMatchObject({
        contentLocale: "en",
        isFallback: false,
        canonicalPath: path,
      });
    },
  );

  it("publishes reciprocal alternates only for an existing Chinese file", () => {
    const english = getPageLocaleState(
      "/docs/native",
      "en",
      nativeChinesePages,
    );
    const chinese = getPageLocaleState(
      "/docs/native",
      "zh-CN",
      nativeChinesePages,
    );
    expect(english).toEqual({
      contentLocale: "en",
      isFallback: false,
      canonicalPath: "/docs/native",
      alternates: [
        { locale: "en", path: "/docs/native" },
        { locale: "zh-CN", path: "/zh-CN/docs/native" },
        { locale: "x-default", path: "/docs/native" },
      ],
    });
    expect(chinese).toEqual({
      ...english,
      contentLocale: "zh-CN",
      canonicalPath: "/zh-CN/docs/native",
    });
  });

  it.each([
    "/zh-CN/docs/native/",
    "/en/docs/native/",
    "/docs/native.md",
    "/zh-CN/docs/native.md/",
    "/llms.mdx/docs/native/content.md",
    "/zh-CN/llms.mdx/docs/native/content.md/",
    "/docs/native/?query=1#anchor",
  ])("normalizes an HTML or Markdown alias: %s", (path) => {
    expect(getPageLocaleState(path, "ZH_cn", nativeChinesePages)).toEqual(
      getPageLocaleState("/docs/native", "zh-CN", nativeChinesePages),
    );
  });

  it("preserves dots in release slugs", () => {
    expect(
      getPageLocaleState(
        "/zh-CN/changelog/2.1.0.md",
        "zh-CN",
        nativeChinesePages,
      ).canonicalPath,
    ).toBe("/zh-CN/changelog/2.1.0");
  });

  it.each(["/docs.md", "/zh-CN/docs.md/", "/llms.mdx/docs/content.md"])(
    "maps the native index's Markdown alias to its HTML path: %s",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", nativeChinesePages)).toEqual(
        getPageLocaleState("/docs", "zh-CN", nativeChinesePages),
      );
    },
  );

  it.each(["/", "/community", "/workbench", "/blog", "/changelog"])(
    "uses the Chinese catalog for %s even when content files are missing",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", new Set())).toMatchObject({
        contentLocale: "zh-CN",
        isFallback: false,
        canonicalPath: `/zh-CN${path === "/" ? "" : path}`,
      });
    },
  );

  it("defaults unknown locales to English", () => {
    expect(
      getPageLocaleState("/docs/native/", "fr", nativeChinesePages),
    ).toEqual(getPageLocaleState("/docs/native", "en", nativeChinesePages));
  });

  it("uses English for a path absent from the native inventory", () => {
    expect(getPageLocaleState("/docs/native", "zh-CN")).toMatchObject({
      contentLocale: "en",
      isFallback: true,
      canonicalPath: "/docs/native",
    });
  });
});
