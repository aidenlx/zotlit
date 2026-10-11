import { describe, expect, it } from "vitest";

import type { TranslationManifest } from "./translation-state";
import { getPageLocaleState } from "./translation-state";

const manifest: TranslationManifest = {
  pages: {
    "/docs": "placeholder",
    "/docs/ready": "translated",
    "/docs/pending": "placeholder",
    "/blog": "placeholder",
    "/blog/ready": "translated",
    "/changelog/2.1.0": "translated",
  },
  ui: "placeholder",
};

// Failure modes: missing locale files and marked copies must never advertise
// Chinese content; approved pages need reciprocal links; URL aliases must make
// the same decision; UI readiness must remain independent from content pages.
describe("getPageLocaleState", () => {
  it.each(["/docs", "/docs/pending", "/docs/missing"])(
    "keeps an unapproved Chinese page on its English canonical: %s",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", manifest)).toEqual({
        contentLocale: "en",
        isPlaceholder: true,
        canonicalPath: path,
        alternates: [
          { locale: "en", path },
          { locale: "x-default", path },
        ],
      });
      expect(getPageLocaleState(path, "en", manifest)).toMatchObject({
        contentLocale: "en",
        isPlaceholder: false,
        canonicalPath: path,
      });
    },
  );

  it("publishes reciprocal alternates only for an approved translation", () => {
    const english = getPageLocaleState("/docs/ready", "en", manifest);
    const chinese = getPageLocaleState("/docs/ready", "zh-CN", manifest);
    expect(english).toEqual({
      contentLocale: "en",
      isPlaceholder: false,
      canonicalPath: "/docs/ready",
      alternates: [
        { locale: "en", path: "/docs/ready" },
        { locale: "zh-CN", path: "/zh-CN/docs/ready" },
        { locale: "x-default", path: "/docs/ready" },
      ],
    });
    expect(chinese).toEqual({
      ...english,
      contentLocale: "zh-CN",
      canonicalPath: "/zh-CN/docs/ready",
    });
  });

  it.each([
    "/zh-CN/docs/ready/",
    "/en/docs/ready/",
    "/docs/ready.md",
    "/zh-CN/docs/ready.md/",
    "/llms.mdx/docs/ready/content.md",
    "/zh-CN/llms.mdx/docs/ready/content.md/",
    "/docs/ready/?query=1#anchor",
  ])("normalizes an HTML or Markdown alias: %s", (path) => {
    expect(getPageLocaleState(path, "ZH_cn", manifest)).toEqual(
      getPageLocaleState("/docs/ready", "zh-CN", manifest),
    );
  });

  it("preserves dots in release slugs", () => {
    expect(
      getPageLocaleState("/zh-CN/changelog/2.1.0.md", "zh-CN", manifest)
        .canonicalPath,
    ).toBe("/zh-CN/changelog/2.1.0");
  });

  it.each(["/docs.md", "/zh-CN/docs.md/", "/llms.mdx/docs/content.md"])(
    "maps the native index's Markdown alias to its HTML path: %s",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", manifest)).toEqual(
        getPageLocaleState("/docs", "zh-CN", manifest),
      );
    },
  );

  it.each(["/", "/community", "/workbench"])(
    "uses explicit UI readiness for %s",
    (path) => {
      expect(getPageLocaleState(path, "zh-CN", manifest).isPlaceholder).toBe(
        true,
      );
      expect(
        getPageLocaleState(path, "zh-CN", { ...manifest, ui: "translated" }),
      ).toMatchObject({
        contentLocale: "zh-CN",
        isPlaceholder: false,
        canonicalPath: `/zh-CN${path === "/" ? "" : path}`,
      });
    },
  );

  it("keeps a mixed listing unapproved even when its UI is ready", () => {
    expect(
      getPageLocaleState("/blog", "zh-CN", {
        ...manifest,
        ui: "translated",
      }).isPlaceholder,
    ).toBe(true);
  });

  it("defaults unknown locales to English", () => {
    expect(getPageLocaleState("/docs/ready/", "fr", manifest)).toEqual(
      getPageLocaleState("/docs/ready", "en", manifest),
    );
  });

  it("fails closed when no compile-time manifest is available", () => {
    expect(getPageLocaleState("/docs/ready", "zh-CN")).toMatchObject({
      contentLocale: "en",
      isPlaceholder: true,
      canonicalPath: "/docs/ready",
    });
  });
});
