import { describe, expect, it } from "vitest";

import type { ObsidianTextItem } from "@/chars";
import { itemMetrics, normalizeChar, toZoteroChars } from "@/chars";

/** An upright 10 pt chunk whose baseline sits at y = 700. */
const upright = (...chars: { c: string; u?: string }[]): ObsidianTextItem => ({
  transform: [10, 0, 0, 10, 72, 700],
  fontName: "ABCDEF+Times",
  chars: chars.map(({ c, u }, index) => ({
    c,
    u: u ?? c,
    r: [72 + index * 5, 695, 77 + index * 5, 707],
  })),
});

describe("the four filter rules", () => {
  it("drops the space glyphs Obsidian pushes and Zotero never records", () => {
    const chars = toZoteroChars([upright({ c: "a" }, { c: " " }, { c: "b" })]);

    expect(chars.map(({ c }) => c)).toEqual(["a", "b"]);
  });

  it("drops ASCII and extended control characters", () => {
    const chars = toZoteroChars([
      upright(
        { c: "a" },
        { c: "\u0000" },
        { c: "\u001F" },
        { c: "\u007F" },
        { c: "\u009F" },
        { c: "b" },
      ),
    ]);

    expect(chars.map(({ c }) => c)).toEqual(["a", "b"]);
  });

  it("splits a ligature into `c` while `u` keeps the raw glyph", () => {
    const [ligature] = toZoteroChars([upright({ c: "\uFB01" })]);

    expect(ligature).toMatchObject({ c: "fi", u: "\uFB01" });
  });

  it("puts an accented letter back together, as Zotero's table does", () => {
    // Both spellings of e-grave, precomposed and decomposed, land on U+00E8.
    expect(normalizeChar("\u00E8")).toBe("\u00E8");
    expect(normalizeChar("e\u0300")).toBe("\u00E8");
    // Outside the table NFKD stands: t-below-dot stays decomposed.
    expect(normalizeChar("\u1E6D")).toBe("t\u0323");
  });
});

describe("the metrics an item's text matrix carries", () => {
  it("reads an upright chunk's size and baseline", () => {
    expect(itemMetrics([10, 0, 0, 10, 72, 700])).toEqual({
      fontSize: 10,
      rotation: 0,
      baseline: 700,
    });
  });

  it("reads a quarter-turn chunk's baseline off the x axis", () => {
    expect(itemMetrics([0, 12, -12, 0, 560, 120])).toEqual({
      fontSize: 12,
      rotation: 90,
      baseline: 560,
    });
  });

  it("snaps a near-upright matrix onto a standard angle", () => {
    expect(itemMetrics([10, 0.05, -0.05, 10, 0, 0]).rotation).toBe(0);
    expect(itemMetrics([-10, -0.05, 0.05, -10, 0, 0]).rotation).toBe(180);
  });
});

describe("the adapted characters", () => {
  it("give every glyph of a chunk the chunk's font and metrics", () => {
    expect(toZoteroChars([upright({ c: "a" }, { c: "b" })])).toEqual([
      {
        c: "a",
        u: "a",
        rect: [72, 695, 77, 707],
        fontSize: 10,
        fontName: "ABCDEF+Times",
        rotation: 0,
        baseline: 700,
      },
      {
        c: "b",
        u: "b",
        rect: [77, 695, 82, 707],
        fontSize: 10,
        fontName: "ABCDEF+Times",
        rotation: 0,
        baseline: 700,
      },
    ]);
  });

  it("skips an item that carries no glyphs", () => {
    const empty: ObsidianTextItem = {
      transform: [10, 0, 0, 10, 0, 0],
      fontName: "ABCDEF+Times",
    };

    expect(toZoteroChars([empty, upright({ c: "a" })])).toHaveLength(1);
  });
});
