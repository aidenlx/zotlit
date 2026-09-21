import { expect, it } from "vitest";

import { losslessWebp } from "./__fixtures__/webp";
import { usableExcerptWebp, webpDimensions } from "./webp";

it("finds VP8L after extended metadata chunks", () => {
  expect(usableExcerptWebp(losslessWebp)).toBe(true);
  expect(webpDimensions(losslessWebp)).toEqual({ width: 2, height: 2 });
});

it.each([
  ["truncated", new Uint8Array([82, 73, 70, 70, 10, 0, 0, 0, 87, 69, 66, 80])],
  [
    "lossy",
    new Uint8Array([
      82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0,
    ]),
  ],
  ["bad signature", new Uint8Array(25)],
] as const)("rejects malformed WebP (%s)", (_name, bytes) => {
  expect(usableExcerptWebp(bytes)).toBe(false);
});

it("rejects reserved VP8L version bits", () => {
  const bytes = new Uint8Array(losslessWebp);
  const chunk = bytes.findIndex(
    (_byte, index) =>
      bytes[index] === 86 &&
      bytes[index + 1] === 80 &&
      bytes[index + 2] === 56 &&
      bytes[index + 3] === 76,
  );
  expect(chunk).toBeGreaterThanOrEqual(0);
  bytes[chunk + 12]! |= 0x20;
  expect(usableExcerptWebp(bytes)).toBe(false);
});

it("rejects an encoded payload above the external asset bound", () => {
  const bytes = new Uint8Array(32 * 1024 * 1024 + 1);
  bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  expect(usableExcerptWebp(bytes)).toBe(false);
});
