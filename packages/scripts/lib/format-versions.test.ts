import { describe, expect, it } from "vitest";

import {
  compareFormatVersion,
  latestReleaseTag,
  readFormatVersion,
} from "./format-versions.ts";

const entry = {
  name: "Fixture store",
  file: "store.ts",
  constant: "SCHEMA_VERSION",
};

// Failure modes: repeated unreleased bumps, new formats starting above 1,
// missing declarations, malformed literals, and resource tags as the baseline.
describe("persisted format versions", () => {
  it.each([
    [1, 1, true],
    [2, 1, true],
    [3, 1, false],
    [1, null, true],
    [2, null, false],
    [0, null, false],
    [null, 1, false],
    [1, 2, true],
  ])("compares HEAD %s with release %s", (head, released, allowed) => {
    const source = (value: number | null) =>
      value === null
        ? "export const OTHER = 7;"
        : `const SCHEMA_VERSION = ${value};`;
    const error = compareFormatVersion(
      entry,
      readFormatVersion(source(head), entry.constant),
      readFormatVersion(source(released), entry.constant),
    );
    expect(error === null).toBe(allowed);
  });

  it("reports the constant, both values and the release rule", () => {
    const error = compareFormatVersion(entry, 3, 1);
    expect(error).toContain("SCHEMA_VERSION (store.ts): HEAD=3, release=1");
    expect(error).toContain(
      "One bump per release; a version that has not shipped stays where it is",
    );
    expect(compareFormatVersion(entry, 2, null)).toContain("release=absent");
  });

  it("reads exported and typed constants", () => {
    expect(
      readFormatVersion(
        "export const SCHEMA_VERSION: number =\n  12;",
        entry.constant,
      ),
    ).toBe(12);
    expect(
      readFormatVersion(
        "// const SCHEMA_VERSION = 99;\nconst OTHER_SCHEMA_VERSION = 3;",
        entry.constant,
      ),
    ).toBeNull();
  });

  it.each(["1 + 1", "1.5", "Number('1')", "9007199254740992"])(
    "rejects an unsupported initializer: %s",
    (value) => {
      expect(() =>
        readFormatVersion(`const SCHEMA_VERSION = ${value};`, entry.constant),
      ).toThrow("decimal integer literal");
    },
  );

  it("orders releases by semantic version and excludes non-version tags", () => {
    expect(
      latestReleaseTag([
        "res-9.0.0",
        "zt-9.0.0",
        "zotero-release",
        "2.2.0-beta.9",
        "2.2.0-beta.10",
        "2.1.9",
      ]),
    ).toBe("2.2.0-beta.10");
    expect(latestReleaseTag(["2.2.0-beta.10", "2.2.0", "2.1.9"])).toBe("2.2.0");
  });

  it("explains how to obtain a missing baseline", () => {
    expect(() => latestReleaseTag(["res-2.2.0", "zt-2.2.0"])).toThrow(
      "git fetch origin --tags",
    );
  });
});
