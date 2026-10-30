// Proves the vault read's WebP pixel check against the decoder the plugin
// actually draws with: a durable asset link is rendered by Chromium, so the
// renderer is where "these bytes have no pixels" has to be observable. A Node
// process has no WebP decoder, which is why this trial exists.
import { check } from "./__fixtures__/check";
import { chromiumLosslessWebp, sizedWebp } from "./__fixtures__/webp";
import { usableExcerptWebp } from "./webp";
import { usableExcerptWebpPixels } from "./webp-pixels";

export interface WebpPixelsReport {
  passed: string[];
}

export async function run(): Promise<WebpPixelsReport> {
  const passed: string[] = [];
  // The committed fixture the container walk accepts on its own: headers that
  // declare an 8 × 8 image, and not one sample of its pixel data.
  const headerOnly = sizedWebp(8, 8);
  check(
    usableExcerptWebp(headerOnly),
    "The header-only fixture must pass the structural check this trial deepens",
  );
  check(
    !(await usableExcerptWebpPixels(headerOnly)),
    "The renderer's decoder accepted a payload that carries no pixel data",
  );
  passed.push("header-only payload refused");

  // The positive control: the same check must not refuse lossless output.
  check(
    await usableExcerptWebpPixels(chromiumLosslessWebp),
    "The renderer's decoder refused real lossless WebP output",
  );
  passed.push("lossless payload accepted");

  return { passed };
}
