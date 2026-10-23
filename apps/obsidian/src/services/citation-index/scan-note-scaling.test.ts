// #1689: unmatched math openers must not repeatedly scan the paragraph suffix.
import { expect, it } from "vitest";

import { scanNote } from "./scan-note";

it.each([
  {
    name: "unmatched inline openers",
    source: (count: number) => `${"$x ".repeat(count)}[[Note]]`,
    links: ["Note"],
  },
  {
    name: "invalid display closer runs",
    source: (count: number) => `$$\n${"$".repeat(count)} x\n[[Note]]`,
    links: [],
  },
])(
  "scans $name in linear time (#1689)",
  ({ source, links }) => {
    const counts = [2_000, 4_000, 8_000, 16_000];
    const sources = counts.map(source);
    const samples = sources.map(() => [] as number[]);
    const sampleCount = 21;
    const scansPerSample = 3;
    for (const source of sources) {
      for (let warmup = 0; warmup < 10; warmup++) {
        expect(scanNote(source).wikilinks.map((link) => link.raw)).toEqual(
          links,
        );
      }
    }
    // Alternate size order to distribute host load across sizes.
    const indices = [0, 1, 2, 3];
    for (let sample = 0; sample < sampleCount; sample++) {
      for (const index of indices) {
        let linkCount = 0;
        const start = performance.now();
        for (let scan = 0; scan < scansPerSample; scan++)
          linkCount += scanNote(sources[index]!).wikilinks.length;
        samples[index]!.push((performance.now() - start) / scansPerSample);
        expect(linkCount).toBe(links.length * scansPerSample);
      }
      indices.reverse();
    }
    const medians = samples.map(
      (times) => times.toSorted((a, b) => a - b)[Math.floor(sampleCount / 2)]!,
    );
    for (let index = 1; index < medians.length; index++) {
      expect(
        medians[index]! / medians[index - 1]!,
        `${counts[index - 1]} → ${counts[index]} openers: ${medians[index - 1]} → ${medians[index]} ms`,
      ).toBeLessThan(3);
    }
  },
  60_000,
);
