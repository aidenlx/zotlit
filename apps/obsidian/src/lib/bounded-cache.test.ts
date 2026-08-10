import { describe, expect, it } from "vitest";

import { BoundedCache } from "./bounded-cache";

describe("BoundedCache", () => {
  it("runs the maker once for a key it already holds", () => {
    const cache = new BoundedCache<string>(2);
    let made = 0;
    const make = () => `value ${++made}`;

    expect(cache.hold("a", make)).toBe("value 1");
    expect(cache.hold("a", make)).toBe("value 1");
    expect(made).toBe(1);
  });

  it("drops the value asked for least recently", () => {
    const cache = new BoundedCache<string>(2);
    cache.hold("a", () => "A");
    cache.hold("b", () => "B");
    // The ask for "a" puts "b" furthest in the past, so "c" takes its place.
    cache.hold("a", () => "other");
    cache.hold("c", () => "C");

    expect(cache.size).toBe(2);
    expect(cache.peek("a")).toBe("A");
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("c")).toBe("C");
  });

  it("leaves the eviction order as it is on a peek", () => {
    const cache = new BoundedCache<string>(2);
    cache.hold("a", () => "A");
    cache.hold("b", () => "B");
    cache.peek("a");
    cache.hold("c", () => "C");

    expect(cache.peek("a")).toBeUndefined();
  });
});
