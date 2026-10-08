// The Chinese Segmenter in the worker: the Item Index cuts CJK text with the installed binary, or with `Intl.Segmenter`.
import { Effect } from "effect";
import type { Layer } from "effect";

import {
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
  SegmenterUnavailable,
} from "@zotlit/item-lookup";

import { getLogger } from "@/lib/log";
import { createOpfsBinaryStore } from "@/services/managed-binary/store";

import { sameBinary } from "./rpc";
import type { SegmenterBinary } from "./rpc";

const logger = getLogger(["zotero-reads", "segmenter"]);

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
 * The Item Index's Segmenter, driven by the installed binary that
 * `Configure` names. `resolve` answers the Segmenter to switch to, and
 * `undefined` when the index keeps its own, so a `Configure` for another
 * setting rebuilds no index. A binary that cannot be read or does not start
 * logs a warning and leaves the index on `Intl.Segmenter`; search keeps
 * answering, and the next `resolve` with that binary tries it again.
 * The caller applies each answer before the next `resolve`.
 *
 * `jieba-wasm` holds one instance per worker: an uninstall stops its use but
 * keeps its memory, and a later binary with another name runs on the bytes
 * that loaded first until the worker restarts.
 */
export function makeSegmenterSwitch(read: ReadSegmenter = noStore): {
  readonly resolve: (
    next: SegmenterBinary | null,
  ) => Effect.Effect<SegmenterService | undefined>;
} {
  /** The binary `Configure` named last. */
  let requested: SegmenterBinary | null = null;
  /** Whether the index cuts with jieba now. */
  let jieba = false;
  /** The binary jieba loaded from in this worker. */
  let loaded: SegmenterBinary | null = null;

  const toNone = Effect.suspend(() => {
    if (!jieba) return Effect.undefined;
    jieba = false;
    return segmenterOf(layerSegmenterNone);
  });

  const install = (binary: SegmenterBinary) =>
    Effect.tryPromise({
      try: () => read(binary),
      catch: (cause) =>
        new SegmenterUnavailable({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }).pipe(
      Effect.flatMap((bytes) => segmenterOf(layerSegmenterJieba(bytes))),
      Effect.tap(() =>
        Effect.sync(() => {
          if (loaded && !sameBinary(loaded, binary)) {
            logger.warn(
              "The Chinese Segmenter keeps its first binary until the worker restarts",
              { loaded: loaded.name, requested: binary.name },
            );
          }
          loaded ??= binary;
          jieba = true;
          logger.info("The Chinese Segmenter cuts CJK text", {
            binary: binary.name,
          });
        }),
      ),
      Effect.catchTag("SegmenterUnavailable", (error) =>
        Effect.andThen(
          Effect.sync(() => {
            // The next `Configure` with the same binary tries it again.
            requested = null;
            logger.warn(
              "The Chinese Segmenter did not start; CJK text uses Intl.Segmenter",
              { binary: binary.name, error: error.message },
            );
          }),
          toNone,
        ),
      ),
    );

  const resolve = (
    next: SegmenterBinary | null,
  ): Effect.Effect<SegmenterService | undefined> =>
    Effect.suspend(() => {
      if (sameBinary(next, requested)) return Effect.undefined;
      requested = next;
      if (next) return install(next);
      logger.info(
        "The Chinese Segmenter is uninstalled; CJK text uses Intl.Segmenter",
      );
      return toNone;
    });

  return { resolve };
}

type SegmenterService = (typeof Segmenter)["Service"];

const segmenterOf = <E>(
  layer: Layer.Layer<Segmenter, E>,
): Effect.Effect<SegmenterService, E> =>
  Effect.provide(Effect.service(Segmenter), layer);
