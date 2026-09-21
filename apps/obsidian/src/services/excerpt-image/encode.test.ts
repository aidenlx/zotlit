import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";
import type { EncodeReport } from "./encode.browser-test";

/**
 * The recorded run's slowest single encode is 17.5 ms
 * (docs/excerpt-image-webp-measurements.md), so a second is a different code path
 * rather than a slower machine.
 */
const MAX_ENCODE_MS = 1000;

it.skipIf(!testElectron)(
  "encodes lossless WebP through the native canvas path",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "encode.browser-test.ts"),
      name: "excerptEncodeTrial",
      marker: "EXCERPT_ENCODE_RESULT",
      timeoutMs: 60_000,
    })) as EncodeReport;

    // The trial throws on any failed check, so this is the shape of a complete
    // run: every stage reported, every crop measured, every payload non-empty.
    expect(report.passed).toHaveLength(3);
    expect(report.measurements).toHaveLength(4);
    expect(new Set(report.measurements.map((entry) => entry.crop)).size).toBe(
      4,
    );
    for (const entry of report.measurements) {
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.pngBytes).toBeGreaterThan(0);
      expect(entry.webpBytes).toBeGreaterThan(0);
      // Timings start at `Infinity` and only fall, so the bound is the assertion
      // that reports a pathology; finiteness rules out a lost measurement.
      expect(Number.isFinite(entry.pngMs)).toBe(true);
      expect(Number.isFinite(entry.webpMs)).toBe(true);
      expect(entry.pngMs).toBeLessThan(MAX_ENCODE_MS);
      expect(entry.webpMs).toBeLessThan(MAX_ENCODE_MS);
    }
    const measured = (crop: string) => {
      const entry = report.measurements.find((value) => value.crop === crop);
      if (!entry) throw new Error(`The trial measured no ${crop} crop`);
      return entry;
    };
    // Recorded run (Electron 43.3.0, Chromium 150, Apple M4 Pro): lossless WebP
    // pays on text, ink, and image crops and costs a small overhead on crops
    // with almost no ink, where the lossless bitstream has little to model.
    for (const crop of ["text", "ink", "image"])
      expect(measured(crop).webpBytes).toBeLessThan(measured(crop).pngBytes);
    const equation = measured("equation");
    expect(equation.webpBytes).toBeLessThanOrEqual(equation.pngBytes * 1.1);
  },
  90_000,
);
