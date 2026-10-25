import { describe, expect, it } from "vitest";

import { classifyDiskData } from "./classify";

describe("classifyDiskData", () => {
  it("treats null as missing", () => {
    expect(classifyDiskData(null)).toEqual({ kind: "missing" });
  });

  it("treats non-plain values (including undefined) as malformed", () => {
    expect(classifyDiskData(undefined).kind).toBe("malformed");
    expect(classifyDiskData([1, 2, 3]).kind).toBe("malformed");
    expect(classifyDiskData("string").kind).toBe("malformed");
    expect(classifyDiskData(42).kind).toBe("malformed");
    expect(
      classifyDiskData(Temporal.Instant.fromEpochMilliseconds(0)).kind,
    ).toBe("malformed");
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

  it("classifies __VERSION__ === 9 as v9", () => {
    const raw = { __VERSION__: 9, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v9", raw });
  });

  it("classifies __VERSION__ === 10 as v10", () => {
    const raw = { __VERSION__: 10, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v10", raw });
  });

  it("classifies __VERSION__ === 11 as v11", () => {
    const raw = { __VERSION__: 11, foo: 1 };
    expect(classifyDiskData(raw)).toEqual({ kind: "v11", raw });
  });

  it("classifies integer __VERSION__ > 11 as future", () => {
    expect(classifyDiskData({ __VERSION__: 12 })).toEqual({
      kind: "future",
      version: 12,
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
