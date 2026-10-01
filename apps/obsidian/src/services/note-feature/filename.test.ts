import { describe, expect, it, vi } from "vitest";

import { filenameSuffix } from "@zotlit/templates";

import {
  EmptyFilenameError,
  resolveFreeFlatName,
  resolveFreeNotePath,
} from "./filename";

describe("resolveFreeNotePath", () => {
  const existsIn =
    (paths: Iterable<string>) =>
    (rel: string): boolean =>
      new Set(paths).has(rel);

  it("routes a slash in the rendered name into a subfolder", () => {
    expect(resolveFreeNotePath("2020/smith:a", existsIn([]))).toBe(
      "2020/smith_a",
    );
  });

  it.each([
    ["empty input", ""],
    ["trailing slash leaves empty name", "smith2020/"],
    ["suffix marker alone", filenameSuffix()],
  ])("throws EmptyFilenameError for %s", (_label, input) => {
    expect(() => resolveFreeNotePath(input, existsIn([]))).toThrow(
      EmptyFilenameError,
    );
  });

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

describe("resolveFreeFlatName", () => {
  it("keeps the name flat: a slash becomes an underscore", () => {
    expect(resolveFreeFlatName("2020/smith", () => false)).toBe("2020_smith");
  });

  it("throws EmptyFilenameError for an empty name", () => {
    expect(() => resolveFreeFlatName("...", () => false)).toThrow(
      EmptyFilenameError,
    );
  });
});
