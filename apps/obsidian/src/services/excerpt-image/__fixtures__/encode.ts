// Browser trials enter the same encoder through the renderer's Effect runner.
import { Effect } from "effect";

import { encodeExcerptImage as encode } from "@/services/excerpt-image/encode";

export function encodeExcerptImage(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return Effect.runPromise(encode(canvas), { signal });
}
