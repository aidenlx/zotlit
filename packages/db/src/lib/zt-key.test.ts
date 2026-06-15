import { describe, expect, it } from "vitest";

import { formatIndexedKey, isIndexedKey, parseIndexedKey } from "./zt-key";

describe("formatIndexedKey", () => {
  it("returns the bare key for personal-library items", () => {
    expect(formatIndexedKey("ABCD2345", null)).toBe("ABCD2345");
    expect(formatIndexedKey("ABCD2345", undefined)).toBe("ABCD2345");
  });

  it("appends the group suffix for group-library items", () => {
    expect(formatIndexedKey("ABCD2345", 42)).toBe("ABCD2345g42");
  });
});

describe("parseIndexedKey", () => {
  it("returns a null groupID for a personal-library key", () => {
    expect(parseIndexedKey("ABCD2345")).toEqual({
      key: "ABCD2345",
      groupID: null,
    });
  });

  it("extracts the group id from a group key", () => {
    expect(parseIndexedKey("ABCD2345g42")).toEqual({
      key: "ABCD2345",
      groupID: 42,
    });
  });

  it("returns null for a malformed key", () => {
    expect(parseIndexedKey("not-a-key")).toBeNull();
  });
});

describe("isIndexedKey", () => {
  it("accepts bare and group-suffixed keys", () => {
    expect(isIndexedKey("ABCD2345")).toBe(true);
    expect(isIndexedKey("ABCD2345g42")).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isIndexedKey("lowercase")).toBe(false);
    expect(isIndexedKey("ABCD2345g")).toBe(false);
  });
});
