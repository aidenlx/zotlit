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
    for (let warmup = 0; warmup < 10; warmup += 1) {
      expect(scanPandocCitations(source)).toHaveLength(counts[index]!);
    }
  }

  // Real elapsed time is the behavior under test. Batch scans and alternate
  // size order so timer noise and host load do not favor one size.
  const indices = [0, 1, 2, 3];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (const index of indices) {
      const source = sources[index]!;
      let citationCount = 0;
      const start = performance.now();
      for (let scan = 0; scan < scansPerSample; scan += 1) {
        citationCount += scanPandocCitations(source).length;
      }
      samples[index]!.push((performance.now() - start) / scansPerSample);
      expect(citationCount).toBe(counts[index]! * scansPerSample);
    }
    indices.reverse();
  }
  const medians = samples.map(
    (times) => times.toSorted((a, b) => a - b)[Math.floor(sampleCount / 2)]!,
  );
  for (let index = 1; index < medians.length; index += 1) {
    const ratio = medians[index]! / medians[index - 1]!;
    const measurement = `${counts[index - 1]} → ${counts[index]} Citations: ${medians[index - 1]} → ${medians[index]} ms`;
    // Allow noise around the expected 2x growth, while rejecting quadratic growth.
    expect(ratio, measurement).toBeGreaterThan(1.5);
    expect(ratio, measurement).toBeLessThan(3);
  }
});
