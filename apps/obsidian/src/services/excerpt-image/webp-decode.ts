// Browser-only native WebP decoder seam for durable asset validation and the
// independent pixel oracle used by the acceptance measurement.

import { webpDimensions } from "./webp";

const MAX_DECODED_BYTES = 128 * 1024 * 1024;

interface DecodedFrame {
  codedWidth: number;
  codedHeight: number;
  allocationSize(options: { format: "RGBA" }): number;
  copyTo(
    destination: Uint8Array,
    options: { format: "RGBA" },
  ): Promise<unknown>;
  close(): void;
}

interface ImageDecoderLike {
  tracks: { ready: Promise<unknown> };
  decode(options: { frameIndex: number }): Promise<{ image: DecodedFrame }>;
  close(): void;
}

interface ImageDecoderConstructor {
  new (options: { data: BufferSource; type: string }): ImageDecoderLike;
}

export interface DecodedWebpPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export type WebpDecoder = (bytes: Uint8Array) => Promise<DecodedWebpPixels>;

/**
 * Decode with WebCodecs instead of drawing back through a canvas. Canvas
 * `drawImage` premultiplies translucent pixels and is not an independent
 * oracle for the encoder's unpremultiplied source buffer.
 */
export async function decodeWebpPixels(bytes: Uint8Array): Promise<{
  width: number;
  height: number;
  data: Uint8Array;
}> {
  const dimensions = webpDimensions(bytes);
  if (!dimensions) throw new Error("WebP structure is invalid");
  const Decoder = (
    globalThis as unknown as { ImageDecoder?: ImageDecoderConstructor }
  ).ImageDecoder;
  if (!Decoder) throw new Error("WebCodecs ImageDecoder is unavailable");
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  using cleanup = new DisposableStack();
  const decoder = cleanup.adopt(
    new Decoder({ data: input.buffer, type: "image/webp" }),
    (value) => value.close(),
  );
  await decoder.tracks.ready;
  const image = cleanup.adopt(
    (await decoder.decode({ frameIndex: 0 })).image,
    (value) => value.close(),
  );
  if (
    image.codedWidth !== dimensions.width ||
    image.codedHeight !== dimensions.height
  )
    throw new Error("Decoded WebP dimensions do not match its header");
  const expectedBytes = dimensions.width * dimensions.height * 4;
  if (expectedBytes > MAX_DECODED_BYTES)
    throw new Error("Decoded WebP exceeds the byte limit");
  const allocation = image.allocationSize({ format: "RGBA" });
  if (allocation !== expectedBytes || allocation > MAX_DECODED_BYTES)
    throw new Error("Decoded WebP has an unexpected RGBA allocation");
  const data = new Uint8Array(allocation);
  await image.copyTo(data, { format: "RGBA" });
  return { width: image.codedWidth, height: image.codedHeight, data };
}

/** Proves that a structurally valid WebP is also decodable before publication. */
export async function verifyWebpDecodes(
  bytes: Uint8Array,
  decode: WebpDecoder = decodeWebpPixels,
): Promise<void> {
  const dimensions = webpDimensions(bytes);
  if (!dimensions) throw new Error("WebP structure is invalid");
  const decoded = await decode(bytes);
  if (
    decoded.width !== dimensions.width ||
    decoded.height !== dimensions.height ||
    decoded.data.byteLength !== dimensions.width * dimensions.height * 4
  )
    throw new Error("Decoded WebP dimensions or pixels are invalid");
}
