// Same harness shape as apps/obsidian/src/services/citation-index/scan-note-scaling.test.ts:
// keep the two in step. A shared helper would need a new export from a production package.
import { expect, it } from "vitest";

import { scanPandocCitations } from "./pandoc-citation";

it("scans dense Pandoc Citations in linear time (#1688)", () => {
  const counts = [1_000, 2_000, 4_000, 8_000];
  const sources = counts.map((count) =>
    "[@normal] @author [p. 3; -@other] `@code` [^@note] [@link](url)\n".repeat(
      count / 2,
    ),
  );
  const samples = sources.map(() => [] as number[]);
  const sampleCount = 21;
  const scansPerSample = 3;
  for (const [index, source] of sources.entries()) {
    for (let warmup = 0; warmup < 10; warmup++) {
      expect(scanPandocCitations(source)).toHaveLength(counts[index]!);
    }
  }
  // Real elapsed time is the behavior under test. Batch scans and alternate
  // size order so timer noise and host load do not favor one size.
  const indices = [0, 1, 2, 3];
  for (let sample = 0; sample < sampleCount; sample++) {
    for (const index of indices) {
      let citationCount = 0;
      const start = performance.now();
      for (let scan = 0; scan < scansPerSample; scan++)
        citationCount += scanPandocCitations(sources[index]!).length;
      samples[index]!.push((performance.now() - start) / scansPerSample);
      expect(citationCount).toBe(counts[index]! * scansPerSample);
    }
    indices.reverse();
  }
  // Compare the minimum sample of each size: machine load only adds time to a
  // sample, so the fastest one is the most stable estimate. The median failed
  // once, at a ratio of 3.05, on a busy machine.
  const minimums = samples.map((times) => Math.min(...times));
  // Only the upper bound: linear growth doubles per step and quadratic growth
  // quadruples. Fixed overhead, JIT and GC can make growth sub-linear.
  for (let index = 1; index < minimums.length; index++) {
    expect(
      minimums[index]! / minimums[index - 1]!,
      `${counts[index - 1]} → ${counts[index]} Citations: ${minimums[index - 1]} → ${minimums[index]} ms`,
    ).toBeLessThan(3);
  }
}, 60_000);
