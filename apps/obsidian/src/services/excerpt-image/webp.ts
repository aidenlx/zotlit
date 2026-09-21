// Bounded validation for the lossless VP8L WebP assets this feature emits.

const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_ENCODED_BYTES = 32 * 1024 * 1024;
const MAX_DIMENSION = 16_383;

function fourcc(bytes: Uint8Array, offset: number, value: string): boolean {
  return value
    .split("")
    .every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0),
    );
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

/** Reads dimensions only after the VP8L signature has been established. */
export function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (
    bytes.length < 25 ||
    bytes.length > MAX_ENCODED_BYTES ||
    !fourcc(bytes, 0, "RIFF") ||
    !fourcc(bytes, 8, "WEBP")
  )
    return;
  const riffSize = uint32le(bytes, 4);
  if (riffSize !== bytes.length - 8) return;
  let offset = 12;
  let dimensions: { width: number; height: number } | undefined;
  let extendedDimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return;
    const size = uint32le(bytes, offset + 4);
    const end = offset + 8 + size;
    const paddedEnd = end + (size & 1);
    if (end > bytes.length || paddedEnd > bytes.length) return;
    if (fourcc(bytes, offset, "VP8X")) {
      if (extendedDimensions || size < 10 || (bytes[offset + 8]! & 2) !== 0)
        return;
      extendedDimensions = {
        width:
          1 +
          bytes[offset + 12]! +
          (bytes[offset + 13]! << 8) +
          (bytes[offset + 14]! << 16),
        height:
          1 +
          bytes[offset + 15]! +
          (bytes[offset + 16]! << 8) +
          (bytes[offset + 17]! << 16),
      };
    } else if (fourcc(bytes, offset, "VP8L")) {
      if (dimensions || size < 5 || bytes[offset + 8] !== 0x2f) return;
      const bits = bytes.subarray(offset + 9, offset + 13);
      // The three VP8L version bits are reserved and must remain zero.
      if (bits[3]! >> 5 !== 0) return;
      const width = 1 + (bits[0]! | ((bits[1]! & 0x3f) << 8));
      const height =
        1 + ((bits[1]! >> 6) | (bits[2]! << 2) | ((bits[3]! & 0x0f) << 10));
      if (
        !width ||
        !height ||
        width > MAX_DIMENSION ||
        height > MAX_DIMENSION ||
        width * height * 4 > MAX_DECODED_BYTES
      )
        return;
      dimensions = { width, height };
    } else if (
      fourcc(bytes, offset, "VP8 ") ||
      fourcc(bytes, offset, "ALPH") ||
      fourcc(bytes, offset, "ANIM") ||
      fourcc(bytes, offset, "ANMF")
    ) {
      // The excerpt contract admits one still, lossless VP8L image only.
      return;
    }
    offset = paddedEnd;
  }
  return offset === bytes.length &&
    dimensions &&
    (!extendedDimensions ||
      (extendedDimensions.width === dimensions.width &&
        extendedDimensions.height === dimensions.height))
    ? dimensions
    : undefined;
}

export function usableExcerptWebp(bytes: Uint8Array): boolean {
  return webpDimensions(bytes) !== undefined;
}
