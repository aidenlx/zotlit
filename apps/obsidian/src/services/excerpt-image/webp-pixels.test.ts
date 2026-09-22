import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";
import type { WebpPixelsReport } from "./webp-pixels.browser-test";

/**
 * The vault read's WebP pixel check is the host's decoder, and the host the
 * plugin runs in is Chromium. A Node process has no WebP decoder — the node
 * tests drive that boundary with their own — so the payload a durable asset
 * must not be linked from is refused here, by the real decoder.
 */
it.skipIf(!testElectron)(
  "refuses a vault WebP whose pixel data the renderer's decoder cannot reconstruct",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "webp-pixels.browser-test.ts"),
      name: "excerptWebpPixelsTrial",
      marker: "EXCERPT_WEBP_PIXELS_RESULT",
      timeoutMs: 60_000,
    })) as WebpPixelsReport;

    // The trial throws on any failed check, so a returned report is the shape of
    // a complete run.
    expect(report.passed).toEqual([
      "header-only payload refused",
      "lossless payload accepted",
    ]);
  },
  90_000,
);
