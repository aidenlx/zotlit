import { describe, expect, it, vi } from "vitest";

import {
  formatManagedRegion,
  MARKER_END,
  MARKER_START,
  replaceManagedRegion,
} from "./obsidian";

const oldRegion = `${MARKER_START}\nOLD\n${MARKER_END}`;

describe("replaceManagedRegion", () => {
  it("leaves content untouched when no managed region is present", () => {
    const region = vi.fn(() => "ignored");
    expect(replaceManagedRegion("# Title\n\nbody", region)).toEqual({
      content: "# Title\n\nbody",
      replaced: false,
      duplicateCount: 0,
    });
    expect(region).not.toHaveBeenCalled();
  });

  it("replaces the single managed region with the new region", () => {
    const region = formatManagedRegion("NEW");
    expect(
      replaceManagedRegion(`before\n${oldRegion}\nafter`, () => region),
    ).toEqual({
      content: `before\n${region}\nafter`,
      replaced: true,
      duplicateCount: 0,
    });
  });

  it("inserts `$$…$$` display math verbatim, not as replace patterns", () => {
    const region = formatManagedRegion("$$E=mc^2$$");
    const { content } = replaceManagedRegion(
      `before\n${oldRegion}\nafter`,
      () => region,
    );
    expect(content).toBe(`before\n${region}\nafter`);
    expect(content).toContain("$$E=mc^2$$");
  });

  it("inserts `$&`, `$'`, and `$\\`` verbatim, not as replace patterns", () => {
    const region = formatManagedRegion("literal $& $' $` end");
    const { content } = replaceManagedRegion(
      `before\n${oldRegion}\nafter`,
      () => region,
    );
    expect(content).toBe(`before\n${region}\nafter`);
  });

  it("leaves content untouched when markers are unbalanced", () => {
    const region = vi.fn(() => "ignored");

    const startOnly = `before\n${MARKER_START}\nOLD\nafter`;
    expect(replaceManagedRegion(startOnly, region)).toEqual({
      content: startOnly,
      replaced: false,
      duplicateCount: 0,
    });

    const endOnly = `before\nOLD\n${MARKER_END}\nafter`;
    expect(replaceManagedRegion(endOnly, region)).toEqual({
      content: endOnly,
      replaced: false,
      duplicateCount: 0,
    });

    expect(region).not.toHaveBeenCalled();
  });

  it("replaces only the first region and counts the rest as duplicates", () => {
    const region = formatManagedRegion("NEW");
    const result = replaceManagedRegion(
      `${oldRegion}\nmid\n${oldRegion}\nend\n${oldRegion}`,
      () => region,
    );
    expect(result).toEqual({
      content: `${region}\nmid\n${oldRegion}\nend\n${oldRegion}`,
      replaced: true,
      duplicateCount: 2,
    });
  });

  it("invokes the provider at most once", () => {
    const region = vi.fn(() => formatManagedRegion("NEW"));
    replaceManagedRegion(`${oldRegion}\nmid\n${oldRegion}`, region);
    expect(region).toHaveBeenCalledTimes(1);
  });
});
