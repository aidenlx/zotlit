// Native Chromium's WebP encoder is lossless at the literal quality value 1.

import { abortable } from "./abortable";
import { metadataForFormat } from "./format";
import type { ExcerptImagePayload } from "./format";
import { usableExcerptWebp, webpDimensions } from "./webp";

export const MAX_WEBP_DIMENSION = 16_383;

interface WebpCanvas {
  width: number;
  height: number;
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void;
}

/**
 * Chromium treats the literal quality `1` as the lossless VP8L request. The
 * chunk parser below verifies the returned bytes and dimensions before any
 * caller can persist or display them.
 */
export async function encodeLosslessWebp(
  canvas: WebpCanvas,
  signal?: AbortSignal,
): Promise<ExcerptImagePayload> {
  const { width, height } = canvas;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_WEBP_DIMENSION ||
    height > MAX_WEBP_DIMENSION
  )
    throw new Error("Excerpt dimensions exceed WebP limits");
  signal?.throwIfAborted();
  const blob = await abortable(
    new Promise<Blob>((resolve, reject) => {
      try {
        // Keep this literal at exactly 1.0: Blink's native lossless branch is
        // selected by an exact floating-point comparison.
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("WebP encoding failed")),
          "image/webp",
          1,
        );
      } catch (error) {
        reject(error);
      }
    }),
    signal,
  );
  signal?.throwIfAborted();
  if (blob.type && blob.type !== "image/webp")
    throw new Error("WebP encoder returned the wrong MIME type");
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
  const dimensions = webpDimensions(bytes);
  if (!usableExcerptWebp(bytes) || !dimensions)
    throw new Error("Encoder returned a non-lossless WebP");
  if (dimensions.width !== width || dimensions.height !== height)
    throw new Error("WebP dimensions do not match the excerpt");
  return {
    bytes,
    ...metadataForFormat("webp", { width, height }),
  };
}
