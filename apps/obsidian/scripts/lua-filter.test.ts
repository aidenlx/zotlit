import { describe, expect, it } from "vitest";

import { buildFilterVariant } from "./lua-filter.ts";

const source = [
  "shared before",
  "--@variant cli",
  "cli only",
  "--@end",
  "--@variant sandbox",
  "sandbox only",
  "--@end",
  "shared after",
].join("\n");

describe("buildFilterVariant", () => {
  it("keeps the requested variant and drops the other", () => {
    expect(buildFilterVariant(source, "cli")).toBe(
      "shared before\ncli only\nshared after",
    );
    expect(buildFilterVariant(source, "sandbox")).toBe(
      "shared before\nsandbox only\nshared after",
    );
  });

  it("rejects a malformed region", () => {
    expect(() => buildFilterVariant("--@variant wasm\n--@end", "cli")).toThrow(
      /Unknown filter variant "wasm"/,
    );
    expect(() =>
      buildFilterVariant("--@variant cli\n--@variant cli\n--@end", "cli"),
    ).toThrow(/Nested/);
    expect(() => buildFilterVariant("--@end", "cli")).toThrow(/without/);
    expect(() => buildFilterVariant("--@variant cli\n", "cli")).toThrow(
      /Unclosed/,
    );
    expect(() => buildFilterVariant("plain source", "cli")).toThrow(
      /no --@variant cli region/,
    );
  });

  it("drops the region markers themselves", () => {
    expect(buildFilterVariant(source, "cli")).not.toContain("--@");
  });
});
