// @vitest-environment happy-dom
import mark from "@brand/zotlit-mark-16.svg?raw";
import wordmark from "@brand/zotlit-wordmark.svg?raw";
import { expect, it } from "vitest";

import { brandPaths } from "./brand";

it("reads a logo's paths by their canonical ink, in order", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0" fill="#1E3A5F"/></g><g><path d="M1 1" fill="#e8622c"/><path d="M2 2" fill="#1E3A5F"/></g></svg>`;
  expect(brandPaths(svg)).toEqual({ ink: ["M0 0", "M2 2"], accent: ["M1 1"] });
  expect(brandPaths(svg, 1)).toEqual({ ink: ["M2 2"], accent: ["M1 1"] });
});

it("refuses a fill outside the two inks, and a group the logo does not have", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" fill="#000"/></svg>`;
  expect(() => brandPaths(svg)).toThrow("#000");
  expect(() => brandPaths(svg, 0)).toThrow("group 0");
});

it("finds the 16-unit mark's two inks, and the wordmark's glyphs after its own mark", () => {
  const cut = brandPaths(mark);
  expect([cut.ink.length, cut.accent.length]).toEqual([1, 1]);
  // Z, o and t in ink; L, i and t in the accent.
  const glyphs = brandPaths(wordmark, 1);
  expect([glyphs.ink.length, glyphs.accent.length]).toEqual([3, 3]);
  // The first group is the wordmark's own 24-unit mark, not its glyphs.
  const own = brandPaths(wordmark, 0);
  expect([own.ink.length, own.accent.length]).toEqual([1, 1]);
});
