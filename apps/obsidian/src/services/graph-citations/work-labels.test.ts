import { describe, expect, it, vi } from "vitest";

import { refreshWorkLabels } from "./work-labels";

describe("Work Label cache", () => {
  it("retains only drawn works, reuses hits, and reads each miss once", () => {
    const doe = { byline: "Doe 2024", title: "Graph study" };
    const pine = { byline: "Pine 2023", title: "Reading maps" };
    const held = new Map([
      ["doe", doe],
      ["removed", pine],
    ]);
    const read = vi.fn(() => pine);
    const next = refreshWorkLabels(held, new Set(["doe", "pine"]), read);
    expect([...next]).toEqual([
      ["doe", doe],
      ["pine", pine],
    ]);
    expect(read).toHaveBeenCalledExactlyOnceWith("pine");
    expect(held.has("removed")).toBe(true);
  });

  it("retains an unreadable miss until invalidation, then retries", () => {
    const read = vi.fn(() => null);
    const keys = new Set(["missing"]);
    const held = refreshWorkLabels(new Map(), keys, read);
    expect(held.get("missing")).toBeNull();
    refreshWorkLabels(held, keys, read);
    expect(read).toHaveBeenCalledOnce();
    refreshWorkLabels(new Map(), keys, read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
