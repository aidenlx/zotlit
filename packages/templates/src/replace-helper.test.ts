import { describe, expect, it } from "vitest";

import { replaceHelper } from "./replace-helper";

describe("replaceHelper", () => {
  it("replaces the first occurrence when present", () => {
    expect(replaceHelper("a-b-a", "a", "x")).toBe("x-b-a");
  });

  it("throws when the target is absent (eta codegen drift fails loud)", () => {
    expect(() => replaceHelper("no match here", "absent", "x")).toThrow(
      /expected eta-generated source not found/,
    );
  });
});
