import { describe, expect, it } from "vitest";

import {
  createLanguageLookup,
  formatItemLanguage,
  parseItemLanguage,
} from "./zt-lang";
import type { LanguageNameLookup, ItemLanguage } from "./zt-lang";

const lookup: LanguageNameLookup = (input) => {
  switch (input.toLowerCase()) {
    case "english":
      return "en";
    case "french":
    case "français":
    case "francais":
      return "fr";
    case "العربية":
      return "ar";
    default:
      return null;
  }
};

describe("parseItemLanguage", () => {
  it("returns null for null/undefined/empty/whitespace input", () => {
    expect(parseItemLanguage(null, lookup)).toBeNull();
    expect(parseItemLanguage(undefined, lookup)).toBeNull();
    expect(parseItemLanguage("", lookup)).toBeNull();
    expect(parseItemLanguage("   ", lookup)).toBeNull();
  });

  it("collapses 2-letter ISO 639-1 codes regardless of case", () => {
    expect(parseItemLanguage("en", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "en",
    });
    expect(parseItemLanguage("EN", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "EN",
    });
    expect(parseItemLanguage("En", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "En",
    });
    expect(parseItemLanguage("fr", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "fr",
      raw: "fr",
    });
  });

  it("maps English language names to ISO 639-1 codes", () => {
    expect(parseItemLanguage("English", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "English",
    });
    expect(parseItemLanguage("French", lookup)).toMatchObject({
      kind: "iso6391",
      code: "fr",
    });
  });

  it("matches case-insensitively and ignores diacritics", () => {
    expect(parseItemLanguage("français", lookup)).toMatchObject({
      kind: "iso6391",
      code: "fr",
    });
    expect(parseItemLanguage("francais", lookup)).toMatchObject({
      kind: "iso6391",
      code: "fr",
    });
    expect(parseItemLanguage("ENGLISH", lookup)).toMatchObject({
      kind: "iso6391",
      code: "en",
    });
  });

  it("matches self-language names (e.g. Arabic in Arabic)", () => {
    expect(parseItemLanguage("العربية", lookup)).toMatchObject({
      kind: "iso6391",
      code: "ar",
    });
  });

  it("skips name lookup when lookup is null", () => {
    expect(parseItemLanguage("English", null)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "english",
      raw: "English",
    });
  });

  it("collapses ISO 639-2/3 codes that V8 canonicalizes to 639-1", () => {
    expect(parseItemLanguage("eng", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "eng",
    });
    expect(parseItemLanguage("ENG", lookup)).toEqual<ItemLanguage>({
      kind: "iso6391",
      code: "en",
      raw: "ENG",
    });
  });

  it("classifies BCP 47 region/script tags as locale", () => {
    expect(parseItemLanguage("en-US", lookup)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "en-US",
      raw: "en-US",
    });
    expect(parseItemLanguage("EN-us", lookup)).toMatchObject({
      kind: "locale",
      tag: "en-US",
    });
    expect(parseItemLanguage("zh-Hant", lookup)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "zh-Hant",
      raw: "zh-Hant",
    });
  });

  it("recovers underscore-separated tags by substituting `_` → `-`", () => {
    expect(parseItemLanguage("en_US", lookup)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "en-US",
      raw: "en_US",
    });
    expect(parseItemLanguage("zh_Hans", lookup)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "zh-Hans",
      raw: "zh_Hans",
    });
  });

  it("classifies syntactically invalid input as text", () => {
    expect(parseItemLanguage("New York", lookup)).toEqual<ItemLanguage>({
      kind: "text",
      raw: "New York",
    });
    expect(parseItemLanguage("English.", lookup)).toEqual<ItemLanguage>({
      kind: "text",
      raw: "English.",
    });
  });

  it("classifies syntactically valid but unknown subtags as locale", () => {
    expect(parseItemLanguage("foobar", lookup)).toEqual<ItemLanguage>({
      kind: "locale",
      tag: "foobar",
      raw: "foobar",
    });
  });

  it("leaves non-locale underscore strings as text", () => {
    expect(
      parseItemLanguage("some_other_underscore_stuff", lookup),
    ).toEqual<ItemLanguage>({
      kind: "text",
      raw: "some_other_underscore_stuff",
    });
  });

  it("preserves `raw` verbatim across all kinds", () => {
    expect(parseItemLanguage("ENGLISH", lookup)?.raw).toBe("ENGLISH");
    expect(parseItemLanguage("en_US", lookup)?.raw).toBe("en_US");
    expect(parseItemLanguage("English.", lookup)?.raw).toBe("English.");
  });
});

describe("createLanguageLookup", () => {
  it("maps English names", () => {
    expect(createLanguageLookup(null)("English")).toBe("en");
  });

  it("maps self-language names", () => {
    const lookup = createLanguageLookup(null);

    expect(lookup("العربية")).toBe("ar");
    expect(lookup("日本語")).toBe("ja");
  });

  it("maps UI-locale names when the UI locale is supported", () => {
    expect(createLanguageLookup("zh")("法语")).toBe("fr");
  });

  it("skips the UI-locale dimension when UI locale is null", () => {
    expect(createLanguageLookup(null)("法语")).toBeNull();
  });

  it("treats invalid UI locales like null", () => {
    expect(createLanguageLookup("foobar")("法语")).toBeNull();
    expect(createLanguageLookup("not a locale")("法语")).toBeNull();
  });
});

describe("formatItemLanguage", () => {
  it("returns '' for null/undefined", () => {
    expect(formatItemLanguage(null)).toBe("");
    expect(formatItemLanguage(undefined)).toBe("");
  });

  it("returns the code for the iso6391 variant", () => {
    expect(formatItemLanguage(parseItemLanguage("English", lookup))).toBe("en");
    expect(formatItemLanguage(parseItemLanguage("EN", lookup))).toBe("en");
  });

  it("returns the canonical tag for the locale variant", () => {
    expect(formatItemLanguage(parseItemLanguage("en_US", lookup))).toBe(
      "en-US",
    );
    expect(formatItemLanguage(parseItemLanguage("zh-Hant", lookup))).toBe(
      "zh-Hant",
    );
  });

  it("returns the raw value for the text variant", () => {
    expect(formatItemLanguage(parseItemLanguage("New York", lookup))).toBe(
      "New York",
    );
    expect(formatItemLanguage(parseItemLanguage("English.", lookup))).toBe(
      "English.",
    );
  });
});
