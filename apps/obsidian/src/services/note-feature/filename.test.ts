import { describe, expect, it, vi } from "vitest";

import { filenameSuffix } from "@zotlit/templates";

import {
  EmptyFilenameError,
  normalizeFilename,
  resolveAvailableRelPath,
  resolveNoteRelPath,
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
    ["dot collapses to empty", ".", ""],
    ["dotdot collapses to empty", "..", ""],
    ["empty stays empty", "", ""],
  ])("%s", (_label, input, expected) => {
    expect(normalizeFilename(input)).toBe(expected);
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

describe("resolveAvailableRelPath", () => {
  const existsIn =
    (paths: Iterable<string>) =>
    (rel: string): boolean =>
      new Set(paths).has(rel);

  it("returns the base name when there is no suffix marker", () => {
    const rel = resolveAvailableRelPath("smith2020", existsIn(["smith2020"]));
    expect(rel).toBe("smith2020");
  });

  it("drops the marker when the base name is free", () => {
    const rel = resolveAvailableRelPath(
      `smith2020${filenameSuffix()}`,
      existsIn([]),
    );
    expect(rel).toBe("smith2020");
  });

  it("appends a random suffix when the base name collides", () => {
    const rel = resolveAvailableRelPath(
      `smith2020${filenameSuffix(6)}`,
      existsIn(["smith2020"]),
    );
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
  });

  it("forces a suffix even when the base name is free", () => {
    const rel = resolveAvailableRelPath(
      `smith2020${filenameSuffix(6)}`,
      existsIn([]),
      true,
    );
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
  });

  it("returns the base name under forceSuffix when there is no marker", () => {
    const rel = resolveAvailableRelPath("smith2020", existsIn([]), true);
    expect(rel).toBe("smith2020");
  });

  it("retries until it finds a free suffixed path", () => {
    const exists = vi
      .fn<(rel: string) => boolean>()
      .mockReturnValueOnce(true) // base collides
      .mockReturnValueOnce(true) // first suffix collides
      .mockReturnValue(false); // second suffix is free
    const rel = resolveAvailableRelPath(
      `smith2020${filenameSuffix(6)}`,
      exists,
    );
    expect(rel).toMatch(/^smith2020_[A-Za-z0-9]{6}$/);
    expect(exists).toHaveBeenCalledTimes(3);
  });

  it("throws rather than returning a colliding path when every attempt collides", () => {
    expect(() =>
      resolveAvailableRelPath(`smith2020${filenameSuffix(6)}`, () => true),
    ).toThrow(/Could not find an available filename/);
  });
});
