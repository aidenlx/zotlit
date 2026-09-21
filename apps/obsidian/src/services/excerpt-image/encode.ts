// The one encoder for generated Excerpt Images. The renderer draws a PDF crop
// onto a canvas and hands it here; the encoded bytes are then reused unchanged by
// the cache entry, the outcome, and the durable note asset.

import { getLogger } from "@/lib/log";

import { abortable } from "./abort";
import { detectExcerptImageFormat, PNG_FORMAT, WEBP_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import { usableExcerptWebp } from "./webp";

const logger = getLogger("excerpt-image");

/**
 * Encodes the crop as lossless WebP. A literal quality of `1` makes Blink select
 * its lossless VP8L encoder, and the returned bytes are checked for that instead
 * of trusting the request: the payload, not the call, decides the format. A host
 * without a canvas WebP encoder hands back the PNG the canvas spec substitutes,
 * which stays PNG everywhere it is stored or displayed.
 */
export async function encodeExcerptImage(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<ExcerptImage> {
  const blob = await abortable(
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (encoded) =>
          encoded
            ? resolve(encoded)
            : reject(new Error("Excerpt encoding failed")),
        "image/webp",
        1,
      ),
    ),
    signal,
  );
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
  if (usableExcerptWebp(bytes, { width: canvas.width, height: canvas.height }))
    return { bytes, format: WEBP_FORMAT };
  if (detectExcerptImageFormat(bytes) === PNG_FORMAT) {
    logger.debug("Canvas has no lossless WebP encoder; the excerpt stays PNG", {
      bytes: bytes.byteLength,
      width: canvas.width,
      height: canvas.height,
    });
    return { bytes, format: PNG_FORMAT };
  }
  throw new Error("Canvas produced an unsupported image payload");
}
