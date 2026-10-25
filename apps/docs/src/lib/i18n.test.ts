import { createFromSource } from "fumadocs-core/search/server";
import { loader } from "fumadocs-core/source";
import { uiTranslations } from "fumadocs-ui/i18n";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { deLocalizeUrl, localizeUrl } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";

import { blogs, changelogs, docs } from "./collections";
import { fumadocsTranslations } from "./fumadocs-translations";
import { i18n, isSiteLocale, unlocalizedPath } from "./i18n";
import { getPageLocaleState } from "./locale-state";
import { contentRouteUrl, suffixEditionUrl } from "./markdown-routes";
import { prerenderPages } from "./prerender-pages";
import { pageHead } from "./seo";
import { nativeChinese } from "./sitemap";
import { blog, changelog, source } from "./source";
import { breadcrumbListSchema } from "./structured-data";

describe("native locale infrastructure", () => {
  it("uses exactly the V1 language URLs", () => {
    expect(i18n.languages).toEqual(["en", "zh-CN"]);
    expect(isSiteLocale("zh")).toBe(false);
    expect(isSiteLocale("fr")).toBe(false);
    expect(isSiteLocale("zh-CN")).toBe(true);
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
      const nativePaths = new Set(
        native.toFumadocsSource().files.map((file) => file.path),
      );
      for (const english of collection.getPages("en")) {
        const chinese = collection.getPage(english.slugs, "zh-CN");
        const nativePath = english.path.replace(/\.(mdx?)$/, ".zh-CN.$1");
        expect(chinese?.path).toBe(
          nativePaths.has(nativePath) ? nativePath : english.path,
        );
        expect(chinese?.url).toBe(`/zh-CN${english.url}`);
        const nativeChinese = nativePaths.has(nativePath);
        expect(getPageLocaleState(english.url, "zh-CN")).toMatchObject({
          contentLocale: nativeChinese ? "zh-CN" : "en",
          isFallback: !nativeChinese,
          canonicalPath: nativeChinese ? `/zh-CN${english.url}` : english.url,
          alternates: [
            { locale: "en", path: english.url },
            ...(nativeChinese
              ? [{ locale: "zh-CN", path: `/zh-CN${english.url}` }]
              : []),
            { locale: "x-default", path: english.url },
          ],
        });
      }
    },
  );
});

// Fumadocs uses the page-tree root name as the first search breadcrumb.
describe("localized search breadcrumb roots", () => {
  it.each(["en", "zh-CN"])("uses available root metadata in %s", (locale) => {
    const contentRoot = join(
      getPackageRoot(import.meta.filename),
      "content/docs",
    );
    const nativeMeta = join(contentRoot, `meta.${locale}.json`);
    const metadata = JSON.parse(
      readFileSync(
        existsSync(nativeMeta) ? nativeMeta : join(contentRoot, "meta.json"),
        "utf8",
      ),
    ) as { title?: string };
    expect(source.getPageTree(locale).name).toBe(metadata.title ?? "Docs");
  });

  it("selects a translated root title when native metadata exists", () => {
    const fixture = loader({
      i18n,
      baseUrl: "/docs",
      source: {
        files: [
          { type: "meta", path: "meta.json", data: { title: "Docs" } },
          { type: "meta", path: "meta.zh-CN.json", data: { title: "文档" } },
          { type: "page", path: "index.mdx", data: { title: "Introduction" } },
          { type: "page", path: "index.zh-CN.mdx", data: { title: "简介" } },
        ],
      },
    });
    expect(fixture.getPageTree("en").name).toBe("Docs");
    expect(fixture.getPageTree("zh-CN").name).toBe("文档");
    expect(fixture.getPage([], "zh-CN")).toMatchObject({
      path: "index.zh-CN.mdx",
      url: "/zh-CN/docs",
      data: { title: "简介" },
    });
  });
});

// Search seam: `/api/search` builds its index with the default options, as here.
describe("locale search", () => {
  const fixture = loader({
    i18n,
    baseUrl: "/docs",
    source: {
      files: ["index.mdx", "index.zh-CN.mdx"].map((path) => ({
        type: "page" as const,
        path,
        data: {
          title: path.includes("zh-CN") ? "插入引用" : "Insert citations",
          structuredData: {
            headings: [],
            contents: [
              {
                heading: undefined,
                content: path.includes("zh-CN")
                  ? "在笔记中插入文献引用的方法"
                  : "How to insert citations into a note",
              },
            ],
          },
        },
      })),
    },
  });

  it.each([
    ["zh-CN", "文献", "/zh-CN/docs"],
    ["en", "citations", "/docs"],
  ])("finds %s words inside unspaced text", async (locale, query, url) => {
    const response = await createFromSource(fixture).GET(
      new Request(
        `https://example.test/api/search?locale=${locale}&query=${encodeURIComponent(query)}`,
      ),
    );
    const results = (await response.json()) as { url: string }[];
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(result.url).toBe(url);
  });
});

it("dates a sitemap's Chinese entry only from a native Chinese file", () => {
  const fixture = loader({
    i18n,
    baseUrl: "/docs",
    source: {
      files: ["native.mdx", "native.zh-CN.mdx", "english-only.mdx"].map(
        (path) => ({ type: "page" as const, path, data: { title: path } }),
      ),
    },
  });
  const [native, englishOnly] = ["native", "english-only"].map((slug) =>
    fixture.getPage([slug], "en")!,
  );
  expect(nativeChinese(fixture, native!)?.path).toBe("native.zh-CN.mdx");
  expect(nativeChinese(fixture, englishOnly!)).toBeUndefined();
});

// Published-route seam: each locale edition needs its own outage-safe asset.
describe("prerendered locale editions", () => {
  it("prerenders native editions and leaves missing-file fallback to the Worker", () => {
    const packageRoot = getPackageRoot(import.meta.filename);
    const paths = new Set(prerenderPages(packageRoot).map((page) => page.path));
    for (const locale of i18n.languages) {
      const prefix = locale === "en" ? "" : "/zh-CN";
      for (const [section, collection] of [
        ["docs", source],
        ["blog", blog],
        ["changelog", changelog],
      ] as const) {
        for (const page of collection.getPages(locale)) {
          const native = locale === "en" || page.path.includes(".zh-CN.");
          expect(paths.has(page.url), `HTML: ${page.url}`).toBe(native);
          expect(
            paths.has(
              prefix + suffixEditionUrl({ section, slugs: page.slugs }),
            ),
          ).toBe(native);
          expect(
            paths.has(prefix + contentRouteUrl({ section, slugs: page.slugs })),
          ).toBe(native);
        }
      }
      for (const path of [
        "",
        "/community",
        "/workbench",
        "/blog",
        "/changelog",
      ]) {
        expect(paths.has(prefix + path || "/")).toBe(true);
      }
    }
    for (const path of [
      "/api/search",
      "/api/release-snapshot",
      "/zh-CN/sitemap.xml",
      "/zh-CN/llms.txt",
    ]) {
      expect(paths.has(path)).toBe(false);
    }
  });
});

// Translation can change an automatic heading slug while incoming links keep
// their original fragment. The compiled table of contents is the reader seam.
describe("translated documentation links", () => {
  for (const { page, anchor } of [
    {
      page: docs.getPage("reference/commands.zh-CN.mdx"),
      anchor: "#query-cli",
    },
    {
      page: docs.getPage("how-to/edit-pdf-annotations.zh-CN.mdx"),
      anchor: "#before-you-edit",
    },
    {
      page: docs.getPage("reference/templates/frontmatter.zh-CN.mdx"),
      anchor: "#spread-entries",
    },
    {
      page: changelogs.get("2.0.0-beta.4.zh-CN.mdx"),
      anchor: "#obsidian-version-requirement",
    },
    {
      page: docs.getPage("how-to/migrate-from-pandoc-reference-list.zh-CN.mdx"),
      anchor: "#在-zotero-中确认文献引用标识",
    },
  ]) {
    it.skipIf(!page)(`retains the authored fragment ${anchor}`, async () => {
      await page!.preload();
      const content = await page!.load();
      expect(content.toc).toContainEqual(
        expect.objectContaining({ url: anchor }),
      );
    });
  }
});

describe("translator-facing UI and formatting", () => {
  it("formats dates in the requested locale while English is the default", async () => {
    const { formatReleaseDate, formatReleaseInstant } =
      await import("./shared");
    expect(formatReleaseDate("2026-10-11")).toBe("October 11, 2026");
    expect(formatReleaseDate("2026-10-11", { locale: "zh-CN" })).toBe(
      "2026年10月11日",
    );
    expect(
      formatReleaseInstant("2026-10-11T23:00:00Z", { locale: "zh-CN" }),
    ).toBe("2026年10月11日");
  });
  it.each(["en", "zh-CN"] as const)(
    "covers the installed native UI registry exactly in %s",
    (locale) => {
      const catalog = fumadocsTranslations(locale);
      expect(Object.keys(catalog).sort()).toEqual(
        [...uiTranslations().keys].sort(),
      );
      expect(
        Object.values(catalog).every(
          (translation) =>
            typeof translation === "string" && translation.trim().length > 0,
        ),
      ).toBe(true);
    },
  );
});

// Failure modes: a missing locale file must not hide a new English page from
// Chinese navigation/search or mistake its fallback body for a native Chinese edition.
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

  it("advertises only the English edition when the Chinese file is missing", () => {
    const nativeChinesePages = new Set<string>();
    const chinese = getPageLocaleState(path, "zh-CN", { nativeChinesePages });
    expect(chinese).toEqual({
      contentLocale: "en",
      isFallback: true,
      canonicalPath: path,
      alternates: [
        { locale: "en", path },
        { locale: "x-default", path },
      ],
    });
    expect(getPageLocaleState(path, "en", { nativeChinesePages })).toEqual({
      ...chinese,
      isFallback: false,
    });
  });
});

// SEO consumer seam: native editions and missing-file fallback publish the same
// canonical policy in head metadata and breadcrumbs under a real locale request.
describe("locale page metadata", () => {
  const hasChineseTutorial = Boolean(docs.getPage("tutorial/index.zh-CN.mdx"));
  const hasChineseRoot = Boolean(docs.getPage("(intro)/index.zh-CN.mdx"));
  it.each([
    {
      path: "/zh-CN/docs/tutorial",
      canonical: hasChineseTutorial ? "/zh-CN/docs/tutorial" : "/docs/tutorial",
      robots: hasChineseTutorial ? "index, follow" : "noindex, follow",
      hasChinese: hasChineseTutorial,
    },
    {
      path: "/docs/tutorial",
      canonical: "/docs/tutorial",
      robots: "index, follow",
      hasChinese: hasChineseTutorial,
    },
    {
      path: "/zh-CN/docs/missing",
      canonical: "/docs/missing",
      robots: "noindex, follow",
      hasChinese: false,
    },
  ] as const)(
    "publishes the edition selected by $path",
    async ({ path, canonical, robots, hasChinese }) => {
      await paraglideMiddleware(
        new Request(`https://zotlit.aidenlx.site${path}`),
        () => {
          const head = pageHead({
            path,
            card: { type: "docs", alt: "Fixture" },
          });
          expect(head.links).toContainEqual({
            rel: "canonical",
            href: `https://zotlit.aidenlx.site${canonical}`,
          });
          expect(head.meta).toContainEqual({ name: "robots", content: robots });
          expect(
            head.links.some(
              (link) => "hrefLang" in link && link.hrefLang === "zh-CN",
            ),
          ).toBe(hasChinese);
          const schema = breadcrumbListSchema([
            { name: "Documentation", url: "/docs" },
            { name: "Duplicate root", url: "/zh-CN/docs" },
            { name: "Page", url: path },
          ]);
          expect(schema.itemListElement).toEqual([
            {
              "@type": "ListItem",
              position: 1,
              name: "Documentation",
              item: `https://zotlit.aidenlx.site${path.startsWith("/zh-CN/") && hasChineseRoot ? "/zh-CN" : ""}/docs`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Page",
              item: `https://zotlit.aidenlx.site${canonical}`,
            },
          ]);
          return new Response("ok");
        },
      );
    },
  );
});
