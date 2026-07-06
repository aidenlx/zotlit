import { describe, expect, it, vi } from "vitest";

import { filenameSuffix } from "@zotlit/templates";

import {
  EmptyFilenameError,
  normalizeFilename,
  resolveFreeNotePath,
  resolveNoteRelPath,
  truncateToByteLimit,
} from "./filename";

describe("normalizeFilename", () => {
  it.each([
    ["plain name", "My Paper", "My Paper"],
    [
      "forbidden chars to underscore",
      'a\\b:c*d?e"f<g>h|i',
      "a_b_c_d_e_f_g_h_i",
    ],
    ["link-target chars to underscore", "a#b^c[d]e", "a_b_c_d_e"],
    ["trailing dots stripped", "name...", "name"],
    ["trailing spaces stripped", "name   ", "name"],
    ["trailing dots and spaces stripped", "name. . ", "name"],
    ["windows reserved prefixed", "CON", "_CON"],
    ["windows reserved case-insensitive", "nul", "_nul"],
    ["windows reserved with number", "COM1", "_COM1"],
    ["non-reserved lookalike untouched", "CONSOLE", "CONSOLE"],
    ["leading dot stripped", ".hidden", "hidden"],
    ["leading dots stripped", "...abc", "abc"],
    ["leading dots with trailing dots", "..abc..", "abc"],
    ["all dots collapses to empty", "...", ""],
    ["dot collapses to empty", ".", ""],
    ["dotdot collapses to empty", "..", ""],
    ["empty stays empty", "", ""],
  ])("%s", (_label, input, expected) => {
    expect(normalizeFilename(input)).toBe(expected);
  });
});

describe("truncateToByteLimit", () => {
  it("returns the string unchanged when within limit", () => {
    expect(truncateToByteLimit("hello", 100)).toBe("hello");
  });

  it("truncates ASCII to byte limit", () => {
    expect(truncateToByteLimit("abcdef", 4)).toBe("abcd");
  });

  it("truncates multi-byte characters without splitting", () => {
    // "é" is U+00E9 → 2 UTF-8 bytes; "a" is 1 byte
    expect(truncateToByteLimit("aéb", 2)).toBe("a");
    expect(truncateToByteLimit("aéb", 3)).toBe("aé");
  });

  it("does not split a surrogate pair (emoji)", () => {
    // "😀" is U+1F600 → 4 UTF-8 bytes, 2 UTF-16 code units
    expect(truncateToByteLimit("a😀b", 4)).toBe("a");
    expect(truncateToByteLimit("a😀b", 5)).toBe("a😀");
  });

  it("handles CJK characters (3 bytes each)", () => {
    // "漢" is U+6F22 → 3 UTF-8 bytes
    expect(truncateToByteLimit("漢字テスト", 9)).toBe("漢字テ");
    expect(truncateToByteLimit("漢字テスト", 10)).toBe("漢字テ");
    expect(truncateToByteLimit("漢字テスト", 12)).toBe("漢字テス");
  });

  it("strips trailing dots/spaces exposed by truncation", () => {
    expect(truncateToByteLimit("abc...xyz", 6)).toBe("abc");
    expect(truncateToByteLimit("abc   xyz", 6)).toBe("abc");
  });

  it("returns empty when first code point exceeds limit", () => {
    expect(truncateToByteLimit("😀", 3)).toBe("");
  });
});

describe("resolveNoteRelPath", () => {
  it.each([
    ["flat name", "My Paper", "My Paper"],
    ["single subfolder", "smith2020/My Paper", "smith2020/My Paper"],
    ["nested subfolders", "a/b/c", "a/b/c"],
    ["empty folder segment dropped", "a//paper", "a/paper"],
    ["dotdot folder segment dropped", "../x", "x"],
    ["dot folder segment dropped", "./x", "x"],
    ["sanitizes per segment", "a:b/c?d", "a_b/c_d"],
  ])("%s → %s", (_label, input, expected) => {
    expect(resolveNoteRelPath(input)).toBe(expected);
  });

  it("truncates a filename segment exceeding the 252-byte limit", () => {
    const long = "a".repeat(300);
    const result = resolveNoteRelPath(long);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(252);
    expect(result).toBe("a".repeat(252));
  });

  it("truncates multi-byte filename to 252 bytes without splitting", () => {
    // 84 CJK chars × 3 bytes = 252 bytes; the 85th would be 255 → truncated
    const long = "漢".repeat(85);
    const result = resolveNoteRelPath(long);
    expect(new TextEncoder().encode(result).length).toBe(252);
    expect(result).toBe("漢".repeat(84));
  });

  it.each([
    ["empty input", ""],
    ["trailing slash leaves empty name", "smith2020/"],
    ["dotdot filename slot", "a/.."],
    ["dot-slash only", "./"],
    ["filename sanitizes to empty", "smith2020/..."],
  ])("throws EmptyFilenameError for %s", (_label, input) => {
    expect(() => resolveNoteRelPath(input)).toThrow(EmptyFilenameError);
  });
});

describe("resolveFreeNotePath", () => {
  const existsIn =
    (paths: Iterable<string>) =>
    (rel: string): boolean =>
      new Set(paths).has(rel);

  it("returns the base name when there is no suffix marker", () => {
    const rel = resolveFreeNotePath("smith2020", existsIn(["smith2020"]));
    expect(rel).toBe("smith2020");
  });

  it("drops the marker when the base name is free", () => {
    const rel = resolveFreeNotePath(
      `smith2020${filenameSuffix()}`,
      existsIn([]),
    );
    expect(rel).toBe("smith2020");
  });

  it("appends a random suffix when the base name collides", () => {
    const rel = resolveFreeNotePath(
      `smith2020${filenameSuffix(6)}`,
      existsIn(["smith2020"]),
    );
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
  });

  it("forces a suffix even when the base name is free", () => {
    const rel = resolveFreeNotePath(
      `smith2020${filenameSuffix(6)}`,
      existsIn([]),
      true,
    );
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
  });

  it("returns the base name under forceSuffix when there is no marker", () => {
    const rel = resolveFreeNotePath("smith2020", existsIn([]), true);
    expect(rel).toBe("smith2020");
  });

  it("retries until it finds a free suffixed path", () => {
    const exists = vi
      .fn<(rel: string) => boolean>()
      .mockReturnValueOnce(true) // base collides
      .mockReturnValueOnce(true) // first suffix collides
      .mockReturnValue(false); // second suffix is free
    const rel = resolveFreeNotePath(`smith2020${filenameSuffix(6)}`, exists);
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
    expect(exists).toHaveBeenCalledTimes(3);
  });

  it("throws rather than returning a colliding path when every attempt collides", () => {
    expect(() =>
      resolveFreeNotePath(`smith2020${filenameSuffix(6)}`, () => true),
    ).toThrow(/Could not find an available filename/);
  });
});
