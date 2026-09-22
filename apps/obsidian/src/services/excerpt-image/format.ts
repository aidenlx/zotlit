// The byte formats an Excerpt Image carries across the cache, vault, and display
// boundaries. Bytes and their metadata are validated together, because a filename
// extension or MIME type that disagrees with the payload misleads every consumer.

import { isWebpContainer, usableExcerptWebp } from "./webp";

export interface ExcerptImageFormat {
  format: "png" | "webp";
  mimeType: "image/png" | "image/webp";
  extension: "png" | "webp";
}

/** Encoded bytes together with the format those exact bytes were validated as. */
export interface ExcerptImage {
  bytes: Uint8Array;
  format: ExcerptImageFormat;
}

/** The canvas encoding path used before this format existed. */
export const PNG_FORMAT: ExcerptImageFormat = {
  format: "png",
  mimeType: "image/png",
  extension: "png",
};
export const WEBP_FORMAT: ExcerptImageFormat = {
  format: "webp",
  mimeType: "image/webp",
  extension: "webp",
};
const KNOWN_FORMATS: Record<string, ExcerptImageFormat> = {
  png: PNG_FORMAT,
  webp: WEBP_FORMAT,
};

/** Every extension ZotLit publishes an Excerpt Image under, legacy PNG assets included. */
export const EXCERPT_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(KNOWN_FORMATS).map((known) => known.extension),
);
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PNG_SIGNATURE.byteLength &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

/** Reads the container the payload actually holds; stored records predate format metadata. */
export function detectExcerptImageFormat(
  bytes: Uint8Array,
): ExcerptImageFormat | undefined {
  if (isPngSignature(bytes)) return PNG_FORMAT;
  return isWebpContainer(bytes) ? WEBP_FORMAT : undefined;
}

/**
 * The payload check each format's bytes must pass. Cheap by design: this is the
 * check every boundary pays, including the cache read that runs before every hit.
 * `materialize.ts` deepens it for the bytes it reads out of the vault — PNG
 * scanlines and WebP pixels alike — and says why there.
 */
const PAYLOAD_CHECKS: Record<string, (bytes: Uint8Array) => boolean> = {
  png: isPngSignature,
  webp: usableExcerptWebp,
};

/** Whether a payload is the container its format names. */
export function isExcerptPayload(
  format: ExcerptImageFormat,
  bytes: Uint8Array,
): boolean {
  return PAYLOAD_CHECKS[format.format]?.(bytes) ?? false;
}

/**
 * The one agreement check: declared format, MIME type, extension, and payload must
 * match. WebP payloads must be the lossless files the encoder was asked for.
 */
export function isExcerptImage(image: ExcerptImage): boolean {
  const known = KNOWN_FORMATS[image.format.format];
  if (
    !known ||
    known.mimeType !== image.format.mimeType ||
    known.extension !== image.format.extension
  )
    return false;
  return isExcerptPayload(known, image.bytes);
}
