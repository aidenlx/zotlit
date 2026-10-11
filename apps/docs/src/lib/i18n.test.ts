import { describe, expect, it } from "vitest";

import { deLocalizeUrl, localizeUrl } from "@/paraglide/runtime.js";

import { i18n, isLocalizedPath, isSiteLocale, unlocalizedPath } from "./i18n";
import { blog, changelog, source } from "./source";

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
  it.each([source, blog, changelog])(
    "loads native Chinese copies rather than fallback source paths",
    (collection) => {
      const english = collection.getPages("en");
      const chinese = collection.getPages("zh-CN");
      expect(chinese.length).toBe(english.length);
      for (const page of chinese) {
        expect(page.path).toContain(".zh-CN.mdx");
        expect(page.url).toMatch(/^\/zh-CN\//);
        expect([undefined, "placeholder"]).toContain(
          page.data.translationStatus,
        );
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
