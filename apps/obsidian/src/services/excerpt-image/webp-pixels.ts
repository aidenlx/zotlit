// Checks that a vault WebP's pixels decode, for the external assets a failed
// refresh falls back to. The container walk in `webp.ts` proves the file's
// shape, not that the image data it declares is there: a header-only container
// passes it, and a damaged one can too.

/**
 * Whether the host's own decoder can reconstruct these lossless WebP pixels.
 *
 * `usableExcerptWebp` proves the container, and this deepens it the way `png.ts`
 * deepens the PNG signature, because a linked asset is drawn by the host's
 * decoder: the container says which image the bytes claim, the decode says
 * whether it is there. Decoding is a host capability rather than a dependency,
 * and a host without one — a Node test process, a WebView older than the
 * `createImageBitmap` it would need — keeps the container result instead of
 * refusing every WebP it cannot inspect.
 */
export async function usableExcerptWebpPixels(
  bytes: Uint8Array,
): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return true;
  try {
    const bitmap = await createImageBitmap(
      // The platform's `Blob` is typed for an `ArrayBuffer` view; these bytes
      // arrive as a `Buffer` subarray, which is the same view over a shared type.
      new Blob([bytes as BlobPart], { type: "image/webp" }),
    );
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}
