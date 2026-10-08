// The Chinese Segmenter in the worker: the reader the Item Index loads an installed binary through.
import { Effect, Layer } from "effect";

import {
  SegmenterBinaryReader,
  SegmenterUnavailable,
} from "@zotlit/item-lookup";

import { createOpfsBinaryStore } from "@/services/managed-binary/store";

import type { SegmenterBinary } from "./rpc";

/** Reads the bytes of an installed Chinese Segmenter binary. */
export type ReadSegmenter = (binary: SegmenterBinary) => Promise<BufferSource>;

/**
 * Reads the binary from the device-wide OPFS store the Chinese Segmenter
 * service installs into. The worker shares the renderer's origin, so it sees
 * the same store.
 */
export const readSegmenterFromOpfs: ReadSegmenter = async ({
  directory,
  name,
}) => {
  const file = await createOpfsBinaryStore(directory).read(name);
  if (!file) throw new Error(`No Chinese Segmenter binary named ${name}`);
  return file.arrayBuffer();
};

/** No store: every binary reads as unavailable. */
const noStore: ReadSegmenter = ({ name }) =>
  Promise.reject(
    new Error(`No store holds the Chinese Segmenter binary ${name}`),
  );

/**
 * The {@link SegmenterBinaryReader} over `read`; a rejection fails with
 * {@link SegmenterUnavailable}. Without `read` every binary reads as
 * unavailable.
 */
export const layerSegmenterBinaryReader = (
  read: ReadSegmenter = noStore,
): Layer.Layer<SegmenterBinaryReader> =>
  Layer.succeed(SegmenterBinaryReader, {
    read: (binary) =>
      Effect.tryPromise({
        try: () => read(binary),
        catch: (cause) =>
          new SegmenterUnavailable({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  });
