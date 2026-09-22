// Real Chromium canvas output for lossless WebP validation. No Node globals: the
// Electron renderer trial loads this module too.

/**
 * Captured from `canvas.toBlob(callback, "image/webp", 1)` in Electron 43.3.0
 * (Chromium 150.0.7871.212) by `encode.browser-test.ts`: an 8x8 crop whose pixels
 * use the alpha values 0, 17, 128, 200, 254, and 255. The extended header carries
 * the ICC profile Chromium writes next to its lossless payload.
 */
export const chromiumLosslessWebp = decodeBase64(
  "UklGRroCAABXRUJQVlA4WAoAAAAwAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdC" +
  "IFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAA" +
  "AADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlk" +
  "ZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAA" +
  "ABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAA" +
  "AAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAA" +
  "AABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEA" +
  "AAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAA" +
  "ACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDhMywAAAC8HwAEQp6EokqRG" +
  "wi0iTwvvzJtLRlBAoQkPaiJJUsPvYLeOwoeD8NFEkpooOKSkiigqXtHTYSQSMGSYjeRgF2FlluFs" +
  "rg5n/S4MQsp7xD5iB99h/bAwCGli3LjfpIGlSANLk7YT8qCJnWhiz95VMVCqWIIUM0CqmCSkIA88" +
  "O0lIooqBUsVAqWKSkATPRhKfIAkwkCTJcHh3z7Zt+zqi/wFm5dMLYqTDDUWLuxOSH7YHRK9udghu" +
  "tW7gnXL5wdnF/IGa2fhA1ZP+ghxEAA==",
);

/** `atob` rather than `Buffer`, so the Electron renderer trial can load this too. */
function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/**
 * A structurally complete lossless WebP of the given dimensions, with an extended
 * header and no pixel data: the validator reads headers and chunks, never pixels.
 */
export function sizedWebp(width: number, height: number): Uint8Array {
  const extended = chunk("VP8X", [
    0x10,
    0,
    0,
    0,
    ...uint24(width - 1),
    ...uint24(height - 1),
  ]);
  const bits = (((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | (1 << 28)) >>> 0;
  const lossless = chunk("VP8L", [0x2f, ...uint32(bits)]);
  const body = [...ascii("WEBP"), ...extended, ...lossless];
  return Uint8Array.from([...ascii("RIFF"), ...uint32(body.length), ...body]);
}

function chunk(fourcc: string, payload: number[]): number[] {
  const bytes = [...ascii(fourcc), ...uint32(payload.length), ...payload];
  if (payload.length & 1) bytes.push(0);
  return bytes;
}

/**
 * The same container with a `JUNK` chunk of `filler` bytes: still a lossless file
 * of that geometry, only larger, for the encoded-size bound.
 */
export function paddedWebp(
  width: number,
  height: number,
  filler: number,
): Uint8Array {
  const base = sizedWebp(width, height);
  const padding = filler + (filler & 1);
  const bytes = new Uint8Array(base.byteLength + 8 + padding);
  const view = new DataView(bytes.buffer);
  bytes.set(base.subarray(0, 12));
  bytes.set(ascii("JUNK"), 12);
  view.setUint32(16, filler, true);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(base.subarray(12), 20 + padding);
  return bytes;
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function uint24(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function uint32(value: number): number[] {
  return [...uint24(value), (value >>> 24) & 0xff];
}
