import { createFromSource } from "fumadocs-core/search/server";
import { loader } from "fumadocs-core/source";
import { describe, expect, it } from "vitest";

import { deLocalizeUrl, localizeUrl } from "@/paraglide/runtime.js";

import { blogs, changelogs, docs } from "./collections";
import { i18n, isLocalizedPath, isSiteLocale, unlocalizedPath } from "./i18n";
import { blog, changelog, source } from "./source";
import { getPageLocaleState } from "./translation-state";

describe("native locale infrastructure", () => {
  it("uses exactly the V1 language URLs", () => {
    expect(i18n.languages).toEqual(["en", "zh-CN"]);
    expect(isSiteLocale("zh")).toBe(false);
    expect(isSiteLocale("fr")).toBe(false);
    expect(isSiteLocale("zh-CN")).toBe(true);
    expect(isLocalizedPath("/zh-CN/docs")).toBe(true);
    expect(isLocalizedPath("/zh-CN-other")).toBe(false);
    expect(unlocalizedPath("/zh-CN/docs")).toBe("/docs");
  });
  it.each([
    "https://zotlit.aidenlx.site",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ])("round-trips URL context on %s", (origin) => {
    const english = new URL("/docs/tutorial?keep=1#install", origin);
    const chinese = localizeUrl(english, { locale: "zh-CN" });
    expect(chinese.pathname).toBe("/zh-CN/docs/tutorial");
    expect(chinese.search).toBe("?keep=1");
    expect(chinese.hash).toBe("#install");
    expect(deLocalizeUrl(chinese).href).toBe(english.href);
  });
  it.each([
    { collection: source, native: docs },
    { collection: blog, native: blogs },
    { collection: changelog, native: changelogs },
  ])(
    "prefers native Chinese files and permits English fallback",
    ({ collection, native }) => {
      for (const english of collection.getPages("en")) {
        const chinese = collection.getPage(english.slugs, "zh-CN");
        const nativePath = english.path.replace(/\.(mdx?)$/, ".zh-CN.$1");
        expect(chinese?.path).toBe(
          native
            .toFumadocsSource()
            .files.some((file) => file.path === nativePath)
            ? nativePath
            : english.path,
        );
        expect(chinese?.url).toBe(`/zh-CN${english.url}`);
      }
    },
  );
});

describe("translator-facing UI and formatting", () => {
  it("formats dates in the requested locale while English is the default", async () => {
    const { formatReleaseDate, formatReleaseInstant } =
      await import("./shared");
    expect(formatReleaseDate("2026-10-11")).toBe("October 11, 2026");
    expect(formatReleaseDate("2026-10-11", "zh-CN")).toBe("2026年10月11日");
    expect(formatReleaseInstant("2026-10-11T23:00:00Z", "zh-CN")).toBe(
      "2026年10月11日",
    );
  });
  it("has matching native UI dictionary keys for translators", async () => {
    const english = await import("#i18n/en.json");
    const chinese = await import("#i18n/zh-CN.json");
    expect(Object.keys(chinese.default.fumadocs)).toEqual(
      Object.keys(english.default.fumadocs),
    );
    expect(Object.keys(chinese.default.fumadocs)).toHaveLength(46);
  });
});

// Failure modes: a missing locale file must not hide a new English page from
// Chinese navigation/search or mistake its fallback body for approved Chinese.
describe("English-only documentation", () => {
  const path = "/docs/how-to/new-feature";
  const fallback = loader({
    i18n,
    baseUrl: "/docs",
    source: {
      files: [
        {
          type: "page",
          path: "how-to/new-feature.mdx",
          data: {
            title: "New feature",
            description: "English-only feature documentation.",
            structuredData: {
              headings: [],
              contents: [
                { heading: undefined, content: "uniquefeaturekeyword" },
              ],
            },
          },
        },
        {
          type: "meta",
          path: "how-to/meta.zh-CN.json",
          data: { title: "How-to guides", pages: ["..."] },
        },
      ],
    },
  });

  it("keeps the Chinese URL while loading the English source and sidebar title", () => {
    const english = fallback.getPage(["how-to", "new-feature"], "en")!;
    const chinese = fallback.getPage(english.slugs, "zh-CN")!;
    expect(chinese.path).toBe(english.path);
    expect(chinese.data).toEqual(english.data);
    expect(chinese.url).toBe(`/zh-CN${path}`);
    expect(JSON.stringify(fallback.getPageTree("zh-CN"))).toContain(
      `"url":"/zh-CN${path}"`,
    );
    expect(JSON.stringify(fallback.getPageTree("zh-CN"))).toContain(
      '"name":"New feature"',
    );
  });

  it.each(["en", "zh-CN"])(
    "indexes English fallback text in %s search",
    async (locale) => {
      const response = await createFromSource(fallback).GET(
        new Request(
          `https://example.test/api/search?locale=${locale}&query=uniquefeaturekeyword`,
        ),
      );
      expect(response.status).toBe(200);
      const results = (await response.json()) as { url: string }[];
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.url).toBe(`${locale === "en" ? "" : "/zh-CN"}${path}`);
      }
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: `${locale === "en" ? "" : "/zh-CN"}${path}`,
          }),
        ]),
      );
    },
  );

  it("advertises only the English edition until a real translation is approved", () => {
    const manifest = { pages: {}, ui: "translated" } as const;
    const chinese = getPageLocaleState(path, "zh-CN", manifest);
    expect(chinese).toEqual({
      contentLocale: "en",
      isPlaceholder: true,
      canonicalPath: path,
      alternates: [
        { locale: "en", path },
        { locale: "x-default", path },
      ],
    });
    expect(getPageLocaleState(path, "en", manifest)).toEqual({
      ...chinese,
      isPlaceholder: false,
    });
  });
});
