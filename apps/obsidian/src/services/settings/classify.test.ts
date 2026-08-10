import { describe, expect, it } from "vitest";

import { classifyDiskData, isPlainObject } from "./classify";

describe("classifyDiskData", () => {
  it("treats null as missing", () => {
    expect(classifyDiskData(null)).toEqual({ kind: "missing" });
  });

  it("treats non-plain values (including undefined) as malformed", () => {
    expect(classifyDiskData(undefined).kind).toBe("malformed");
    expect(classifyDiskData([1, 2, 3]).kind).toBe("malformed");
    expect(classifyDiskData("string").kind).toBe("malformed");
    expect(classifyDiskData(42).kind).toBe("malformed");
    expect(classifyDiskData(new Date()).kind).toBe("malformed");
    expect(classifyDiskData(new Map()).kind).toBe("malformed");
  });

  it("classifies a plain object without __VERSION__ as legacy", () => {
    const raw = { foo: 1, bar: "x" };
    expect(classifyDiskData(raw)).toEqual({ kind: "legacy", raw });
  });

  it("classifies __VERSION__ === 1 as v1", () => {
    const raw = { __VERSION__: 1, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v1", raw });
  });

  it("classifies __VERSION__ === 2 as v2", () => {
    const raw = { __VERSION__: 2, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v2", raw });
  });

  it("classifies __VERSION__ === 3 as v3", () => {
    const raw = { __VERSION__: 3, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v3", raw });
  });

  it("classifies __VERSION__ === 4 as v4", () => {
    const raw = { __VERSION__: 4, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v4", raw });
  });

  it("classifies __VERSION__ === 5 as v5", () => {
    const raw = { __VERSION__: 5, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v5", raw });
  });

  it("classifies __VERSION__ === 6 as v6", () => {
    const raw = { __VERSION__: 6, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v6", raw });
  });

  it("classifies __VERSION__ === 7 as v7", () => {
    const raw = { __VERSION__: 7, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v7", raw });
  });

  it("classifies integer __VERSION__ > 7 as future", () => {
    expect(classifyDiskData({ __VERSION__: 8 })).toEqual({
      kind: "future",
      version: 8,
    });
    expect(classifyDiskData({ __VERSION__: 99 })).toEqual({
      kind: "future",
      version: 99,
    });
  });

  it("treats non-integer or non-positive __VERSION__ as malformed", () => {
    expect(classifyDiskData({ __VERSION__: 0 }).kind).toBe("malformed");
    expect(classifyDiskData({ __VERSION__: -1 }).kind).toBe("malformed");
    expect(classifyDiskData({ __VERSION__: 1.5 }).kind).toBe("malformed");
    expect(classifyDiskData({ __VERSION__: "1" }).kind).toBe("malformed");
    expect(classifyDiskData({ __VERSION__: null }).kind).toBe("malformed");
  });
});

describe("isPlainObject", () => {
  it("accepts object literals", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it("rejects non-plain values", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
  });
});
