import { describe, expect, it } from "vitest";

import { type Creator, type ItemLanguage } from "@zotlit/db";

import { formatCreator } from "./format-creator";

function author(firstName: string | null, lastName: string | null): Creator {
  return { firstName, lastName, creatorType: "author", fieldMode: 0 };
}

function organization(lastName: string | null): Creator {
  return { firstName: null, lastName, creatorType: "author", fieldMode: 1 };
}

function iso6391(code: string): ItemLanguage {
  return { kind: "iso6391", code, raw: code };
}

function locale(tag: string): ItemLanguage {
  return { kind: "locale", tag, raw: tag };
}

describe("formatCreator", () => {
  it("returns lastName verbatim for fieldMode 1", () => {
    expect(
      formatCreator(organization("The Royal Society"), iso6391("zh")),
    ).toBe("The Royal Society");
  });

  it("renders non-romanesque family names before given names without a separator", () => {
    expect(formatCreator(author("澤東", "毛澤東"))).toBe("毛澤東澤東");
  });

  it("keeps family-first ordering when only the given name is romanesque", () => {
    expect(formatCreator(author("Zedong", "毛"))).toBe("毛Zedong");
  });

  it("renders romanesque names family-first for Japanese language metadata", () => {
    expect(formatCreator(author("Taro", "Yamada"), iso6391("ja"))).toBe(
      "Yamada Taro",
    );
  });

  it("renders romanesque names family-first for Chinese language metadata", () => {
    expect(formatCreator(author("Wei", "Wang"), iso6391("zh"))).toBe(
      "Wang Wei",
    );
  });

  it("uses the bare language code from locale tags", () => {
    expect(formatCreator(author("Wei", "Wang"), locale("zh-Hant"))).toBe(
      "Wang Wei",
    );
  });

  it("renders romanesque names given-first by default", () => {
    expect(formatCreator(author("Ada", "Lovelace"), iso6391("en"))).toBe(
      "Ada Lovelace",
    );
    expect(formatCreator(author("Ada", "Lovelace"), null)).toBe("Ada Lovelace");
  });

  it("drops empty name parts without leading or trailing separators", () => {
    expect(formatCreator(author(null, "Lovelace"), iso6391("en"))).toBe(
      "Lovelace",
    );
    expect(formatCreator(author("Ada", null), iso6391("en"))).toBe("Ada");
    expect(formatCreator(author(null, "Wang"), iso6391("zh"))).toBe("Wang");
    expect(formatCreator(author("Wei", null), iso6391("zh"))).toBe("Wei");
  });

  it("returns '' for null/undefined or all-empty creators", () => {
    expect(formatCreator(null)).toBe("");
    expect(formatCreator(undefined)).toBe("");
    expect(formatCreator(author(null, null))).toBe("");
    expect(formatCreator(organization(null))).toBe("");
  });
});
