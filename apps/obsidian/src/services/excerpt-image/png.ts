// Checks complete PNG chunks and bounded decoded scanlines before retaining an existing asset.
import { crc32, inflateSync } from "node:zlib";

const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export function usableExcerptPng(bytes: Buffer): boolean {
  try {
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return false;
    let header: Buffer | undefined;
    const data: Buffer[] = [];
    let paletteEntries = 0;
    let ended = false;
    let dataEnded = false;
    for (let offset = 8; offset < bytes.length; ) {
      if (offset + 12 > bytes.length || ended) return false;
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const chunk = bytes.subarray(offset + 8, end - 4);
      if (
        crc32(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
      )
        return false;
      if (!header && type !== "IHDR") return false;
      if (data.length && type !== "IDAT") dataEnded = true;
      if (type === "IHDR") {
        if (header || length !== 13) return false;
        header = chunk;
      } else if (type === "PLTE") {
        if (
          paletteEntries ||
          data.length ||
          length === 0 ||
          length > 768 ||
          length % 3
        )
          return false;
        paletteEntries = length / 3;
      } else if (type === "IDAT") {
        if (dataEnded) return false;
        data.push(chunk);
      } else if (type === "IEND") {
        if (length || !data.length) return false;
        ended = true;
      } else if ((bytes[offset + 4]! & 32) === 0) return false;
      offset = end;
    }
    if (!ended || !header) return false;
    const width = header.readUInt32BE(0),
      height = header.readUInt32BE(4);
    const depth = header[8]!,
      color = header[9]!,
      interlace = header[12]!;
    if (
      !width ||
      !height ||
      width > 0x7fffffff ||
      height > 0x7fffffff ||
      header[10] ||
      header[11] ||
      interlace > 1
    )
      return false;
    const channels = new Map([
      [0, 1],
      [2, 3],
      [3, 1],
      [4, 2],
      [6, 4],
    ]).get(color);
    if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return false;
    if (
      (color === 3 &&
        (depth === 16 || !paletteEntries || paletteEntries > 2 ** depth)) ||
      (color !== 0 && color !== 3 && depth < 8) ||
      ((color === 0 || color === 4) && paletteEntries)
    )
      return false;
    const passes = interlace ? ADAM7 : ([[0, 0, 1, 1]] as const);
    const rows: { size: number; count: number }[] = [];
    let expected = 0;
    for (const [x, y, dx, dy] of passes) {
      const columns = Math.max(0, Math.ceil((width - x) / dx));
      const count = Math.max(0, Math.ceil((height - y) / dy));
      if (!columns || !count) continue;
      const size = Math.ceil((columns * channels * depth) / 8) + 1;
      expected += size * count;
      if (expected > MAX_DECODED_BYTES) return false;
      rows.push({ size, count });
    }
    const decoded = inflateSync(Buffer.concat(data), {
      maxOutputLength: expected + 1,
    });
    if (decoded.length !== expected) return false;
    let offset = 0;
    for (const { size, count } of rows)
      for (let row = 0; row < count; row++) {
        if (decoded[offset]! > 4) return false;
        offset += size;
      }
    return true;
  } catch {
    return false;
  }
}
