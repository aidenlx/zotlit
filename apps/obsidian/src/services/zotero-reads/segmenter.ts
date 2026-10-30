// The Chinese Segmenter in the worker: the reader the Item Index loads an installed binary through.
import { Effect, Layer } from "effect";

import {
  SegmenterBinaryReader,
  SegmenterUnavailable,
} from "@zotlit/item-lookup";

import { createOpfsBinaryStore } from "@/services/managed-binary/store";

import type { SegmenterBinary } from "./rpc";

/** Reads the bytes of an installed Chinese Segmenter binary. */
export type ReadSegmenter = (
  binary: SegmenterBinary,
) => Effect.Effect<BufferSource, SegmenterUnavailable>;

/**
 * Reads the binary from the device-wide OPFS store the Chinese Segmenter
 * service installs into. The worker shares the renderer's origin, so it sees
 * the same store.
 */
export const readSegmenterFromOpfs: ReadSegmenter = Effect.fn(
  "readSegmenterFromOpfs",
)(function* ({ directory, name }) {
  // boundary: OPFS exposes its file store through Promise APIs.
  const bytes = yield* Effect.tryPromise({
    try: () =>
      createOpfsBinaryStore(directory)
        .read(name)
        .then((file) => file?.arrayBuffer() ?? null),
    catch: segmenterUnavailable,
  });
  if (!bytes)
    return yield* new SegmenterUnavailable({
      message: `No Chinese Segmenter binary named ${name}`,
    });
  return bytes;
});

const segmenterUnavailable = (cause: unknown) =>
  new SegmenterUnavailable({
    message: cause instanceof Error ? cause.message : String(cause),
  });

/** No store: every binary reads as unavailable. */
const noStore: ReadSegmenter = ({ name }) =>
  Effect.fail(
    new SegmenterUnavailable({
      message: `No store holds the Chinese Segmenter binary ${name}`,
    }),
  );

/**
 * The {@link SegmenterBinaryReader} over `read`; a failed read carries
 * {@link SegmenterUnavailable}. Without `read` every binary reads as
 * unavailable.
 */
export const layerSegmenterBinaryReader = (
  read: ReadSegmenter = noStore,
): Layer.Layer<SegmenterBinaryReader> =>
  Layer.succeed(SegmenterBinaryReader, {
    read,
  });
