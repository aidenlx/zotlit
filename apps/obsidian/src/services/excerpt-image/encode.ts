import { Effect } from "effect";
// The one encoder for generated Excerpt Images. The renderer draws a PDF crop
// onto a canvas and hands it here; the encoded bytes are then reused unchanged by
// the cache entry, the outcome, and the durable note asset.

import { withLogCategory } from "@/lib/effect-log";

import { ExcerptImageError } from "./error";
import { detectExcerptImageFormat, PNG_FORMAT, WEBP_FORMAT } from "./format";
import { usableExcerptWebp } from "./webp";

const logged = withLogCategory("excerpt-image");

/**
 * Encodes the crop as lossless WebP. A literal quality of `1` makes Blink select
 * its lossless VP8L encoder, and the returned bytes are checked for that instead
 * of trusting the request: the payload, not the call, decides the format. A host
 * without a canvas WebP encoder hands back the PNG the canvas spec substitutes,
 * which stays PNG everywhere it is stored or displayed.
 */
export const encodeExcerptImage = Effect.fn("ExcerptImage.encode")(function* (
  canvas: HTMLCanvasElement,
) {
  const blob = yield* Effect.tryPromise(
    () =>
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
  );
  const bytes = new Uint8Array(
    yield* Effect.tryPromise(() => blob.arrayBuffer()),
  );
  if (usableExcerptWebp(bytes, { width: canvas.width, height: canvas.height }))
    return { bytes, format: WEBP_FORMAT };
  if (detectExcerptImageFormat(bytes) === PNG_FORMAT) {
    yield* Effect.logDebug(
      "Canvas has no lossless WebP encoder; the excerpt stays PNG",
    ).pipe(
      Effect.annotateLogs({
        bytes: bytes.byteLength,
        width: canvas.width,
        height: canvas.height,
      }),
    );
    return { bytes, format: PNG_FORMAT };
  }
  return yield* new ExcerptImageError({
    message: "Canvas produced an unsupported image payload",
  });
}, logged);
