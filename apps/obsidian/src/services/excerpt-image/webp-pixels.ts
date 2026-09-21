// Checks that externally stored WebP bytes have pixels to decode: the retained
// assets a failed refresh falls back to, and the bytes a note would embed. The
// container walk in `webp.ts` proves the file's shape, not that the image data
// it declares is there: a header-only container passes it, and a damaged one
// can too.

/**
 * Whether the host's own decoder can reconstruct these lossless WebP pixels.
 *
 * `usableExcerptWebp` proves the container, and this deepens it the way `png.ts`
 * deepens the PNG signature, because a linked asset is drawn by the host's
 * decoder: the container says which image the bytes claim, the decode says
 * whether it is there. Decoding is the host's own `createImageBitmap` rather
 * than a dependency, and the host that draws these assets is the one that
 * supplies it; a host that cannot decode them cannot draw them either, so a
 * missing decoder refuses the bytes instead of admitting unvalidated ones. A
 * Node test process has no decoder of its own, which is why the tests that
 * exercise this contract stub the capability and the Electron trial uses the
 * real one.
 */
export async function usableExcerptWebpPixels(
  bytes: Uint8Array,
): Promise<boolean> {
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
