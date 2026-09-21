import { expect, it } from "vitest";

import { redPng } from "./__fixtures__/png";
import {
  chromiumLosslessWebp,
  paddedWebp,
  sizedWebp,
} from "./__fixtures__/webp";
import { usableExcerptWebp } from "./webp";

function offsetOf(bytes: Uint8Array, fourcc: string): number {
  const target = Buffer.from(fourcc, "ascii");
  for (let offset = 12; offset <= bytes.byteLength - 4; offset++)
    if (target.every((byte, index) => bytes[offset + index] === byte))
      return offset;
  throw new Error(`Missing ${fourcc} chunk`);
}

/** Swaps the fourcc of an existing chunk, keeping the file's structure intact. */
function renameChunk(
  bytes: Uint8Array,
  fourcc: string,
  replacement: string,
): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy.set(Buffer.from(replacement, "ascii"), offsetOf(copy, fourcc));
  return copy;
}

it("accepts Chromium lossless output and checks its dimensions", () => {
  expect(usableExcerptWebp(chromiumLosslessWebp)).toBe(true);
  expect(usableExcerptWebp(chromiumLosslessWebp, { width: 8, height: 8 })).toBe(
    true,
  );
  expect(usableExcerptWebp(chromiumLosslessWebp, { width: 9, height: 8 })).toBe(
    false,
  );
  expect(usableExcerptWebp(chromiumLosslessWebp, { width: 8, height: 7 })).toBe(
    false,
  );
});

it("accepts a lossless container whose size and declared geometry fit the bounds", () => {
  // 4 096 × 4 096 costs a decoder 64 MiB of RGBA, which the bounds admit.
  expect(usableExcerptWebp(sizedWebp(4096, 4096))).toBe(true);
  expect(
    usableExcerptWebp(sizedWebp(8192, 1), { width: 8192, height: 1 }),
  ).toBe(true);
});

it("rejects a declared geometry past the dimension ceiling", () => {
  // A 16 384 px side is one step past the ceiling and costs 64 KiB of RGBA here.
  expect(usableExcerptWebp(sizedWebp(16_384, 1))).toBe(false);
});

it("rejects a declared geometry past the decoded byte ceiling", () => {
  // 16 383 × 16 383 would cost a decoder 1 GiB of RGBA from a 44-byte file.
  expect(usableExcerptWebp(sizedWebp(16_383, 16_383))).toBe(false);
});

it("rejects a payload past the encoded byte ceiling", () => {
  expect(usableExcerptWebp(paddedWebp(8, 8, 32 * 1024 * 1024))).toBe(false);
  expect(usableExcerptWebp(paddedWebp(8, 8, 32 * 1024 * 1024 - 1024))).toBe(
    true,
  );
});

it.each(["VP8 ", "ALPH", "ANIM", "ANMF"])(
  "rejects a file whose payload is a %s chunk",
  (chunk) => {
    expect(
      usableExcerptWebp(renameChunk(chromiumLosslessWebp, "VP8L", chunk)),
    ).toBe(false);
  },
);

it("rejects a truncation, a trailing byte, and a wrong RIFF size", () => {
  expect(
    usableExcerptWebp(
      chromiumLosslessWebp.subarray(0, chromiumLosslessWebp.byteLength - 1),
    ),
  ).toBe(false);
  expect(usableExcerptWebp(Uint8Array.from([...chromiumLosslessWebp, 0]))).toBe(
    false,
  );
  const resized = Uint8Array.from(chromiumLosslessWebp);
  resized[4] = resized[4]! - 8;
  expect(usableExcerptWebp(resized)).toBe(false);
});

it("rejects an extended header that claims another size or an animation", () => {
  const width = offsetOf(chromiumLosslessWebp, "VP8X") + 8 + 4;
  const mismatched = Uint8Array.from(chromiumLosslessWebp);
  mismatched[width] = 15;
  expect(usableExcerptWebp(mismatched)).toBe(false);
  const animated = Uint8Array.from(chromiumLosslessWebp);
  animated[width - 4] = animated[width - 4]! | 0x02;
  expect(usableExcerptWebp(animated)).toBe(false);
  const reserved = Uint8Array.from(chromiumLosslessWebp);
  reserved[width - 4] = reserved[width - 4]! | 0x40;
  expect(usableExcerptWebp(reserved)).toBe(false);
});

it("rejects a lossless header with a wrong signature or version", () => {
  const payload = offsetOf(chromiumLosslessWebp, "VP8L") + 8;
  const signature = Uint8Array.from(chromiumLosslessWebp);
  signature[payload] = 0;
  expect(usableExcerptWebp(signature)).toBe(false);
  const version = Uint8Array.from(chromiumLosslessWebp);
  version[payload + 4] = version[payload + 4]! | 0x20;
  expect(usableExcerptWebp(version)).toBe(false);
});

it("rejects bytes that are not a WebP container at all", () => {
  expect(usableExcerptWebp(new Uint8Array())).toBe(false);
  expect(usableExcerptWebp(Uint8Array.from({ length: 32 }, () => 7))).toBe(
    false,
  );
  expect(usableExcerptWebp(redPng)).toBe(false);
});
