// Complete one-pixel PNG fixtures and corrupt variants for retention consumers.
import { crc32 } from "node:zlib";

export const redPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
export const bluePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==",
  "base64",
);

export function corruptPng(
  kind: "truncated" | "idat" | "scanline",
): Buffer<ArrayBuffer> {
  if (kind === "truncated") return redPng.subarray(0, 9);
  const bytes = Buffer.from(redPng);
  if (kind === "idat") {
    bytes[41] = 0;
    bytes.writeUInt32BE(crc32(bytes.subarray(37, 54)), 54);
  } else {
    bytes.writeUInt32BE(2, 16);
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  }
  return bytes;
}
