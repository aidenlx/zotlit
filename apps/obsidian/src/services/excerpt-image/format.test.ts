import { expect, it } from "vitest";

import { redPng } from "./__fixtures__/png";
import { chromiumLosslessWebp, sizedWebp } from "./__fixtures__/webp";
import {
  detectExcerptImageFormat,
  isExcerptImage,
  PNG_FORMAT,
  WEBP_FORMAT,
} from "./format";
import type { ExcerptImageFormat } from "./format";

it("reads the container a payload holds", () => {
  expect(detectExcerptImageFormat(redPng)).toBe(PNG_FORMAT);
  expect(detectExcerptImageFormat(chromiumLosslessWebp)).toBe(WEBP_FORMAT);
  expect(detectExcerptImageFormat(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  expect(detectExcerptImageFormat(new Uint8Array())).toBeUndefined();
});

it("accepts a payload that agrees with its format metadata", () => {
  expect(isExcerptImage({ bytes: redPng, format: PNG_FORMAT })).toBe(true);
  expect(
    isExcerptImage({ bytes: chromiumLosslessWebp, format: WEBP_FORMAT }),
  ).toBe(true);
});

it.each([
  ["a WebP payload declared as PNG", chromiumLosslessWebp, PNG_FORMAT],
  ["a PNG payload declared as WebP", redPng, WEBP_FORMAT],
  ["a truncated WebP payload", sizedWebp(8, 8).subarray(0, 12), WEBP_FORMAT],
  ["unknown bytes", Uint8Array.from([1, 2, 3]), PNG_FORMAT],
])("rejects %s", (_name, bytes, format) => {
  expect(isExcerptImage({ bytes, format })).toBe(false);
});

it("rejects metadata that disagrees with its own format", () => {
  expect(
    isExcerptImage({
      bytes: chromiumLosslessWebp,
      format: { ...WEBP_FORMAT, mimeType: "image/png" },
    }),
  ).toBe(false);
  expect(
    isExcerptImage({
      bytes: redPng,
      format: { ...PNG_FORMAT, extension: "webp" },
    }),
  ).toBe(false);
  expect(
    isExcerptImage({
      bytes: redPng,
      format: {
        format: "avif",
        mimeType: "image/avif",
        extension: "avif",
      } as unknown as ExcerptImageFormat,
    }),
  ).toBe(false);
});
