// The Item Index's Chinese Segmenter switch: the installed binary it cuts CJK text with, or `Intl.Segmenter`.
import { getLogger } from "@logtape/logtape";
import { Context, Effect } from "effect";
import type { Layer } from "effect";

import {
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
} from "./segmenter";
import type { SegmenterUnavailable } from "./segmenter";

/** An installed Chinese Segmenter binary: the file `<directory>/<name>` of a binary store. */
export interface SegmenterBinary {
  readonly directory: string;
  readonly name: string;
}

/** Whether `a` and `b` name the same binary, or both name none. */
export const sameSegmenterBinary = (
  a: SegmenterBinary | null,
  b: SegmenterBinary | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.directory === b.directory &&
    a.name === b.name);

/** Port: reads the bytes of an installed Chinese Segmenter binary. */
export class SegmenterBinaryReader extends Context.Service<
  SegmenterBinaryReader,
  {
    readonly read: (
      binary: SegmenterBinary,
    ) => Effect.Effect<BufferSource, SegmenterUnavailable>;
  }
>()("zotlit/item-lookup/SegmenterBinaryReader") {}

const logger = getLogger(["zotlit", "item-lookup", "segmenter"]);

type SegmenterService = (typeof Segmenter)["Service"];

/**
 * The Item Index's Segmenter, driven by the installed binary the settings
 * name. `resolve` answers the Segmenter to switch to, and `undefined` when the
 * index keeps its own, so a change of another setting rebuilds no index. A
 * binary that cannot be read or does not start logs a warning and leaves the
 * index on `Intl.Segmenter`; search keeps answering, and the next `resolve`
 * with that binary tries it again. The caller applies each answer before the
 * next `resolve`.
 *
 * `jieba-wasm` holds one instance per realm: an uninstall stops its use but
 * keeps its memory, and a later binary with another name runs on the bytes
 * that loaded first until the realm restarts.
 */
export function makeSegmenterSwitch(
  reader: (typeof SegmenterBinaryReader)["Service"],
): {
  readonly resolve: (
    next: SegmenterBinary | null,
  ) => Effect.Effect<SegmenterService | undefined>;
} {
  /** The binary the settings named last. */
  let requested: SegmenterBinary | null = null;
  /** Whether the index cuts with jieba now. */
  let jieba = false;
  /** The binary jieba loaded from in this realm. */
  let loaded: SegmenterBinary | null = null;

  const toNone = Effect.suspend(() => {
    if (!jieba) return Effect.undefined;
    jieba = false;
    return segmenterOf(layerSegmenterNone);
  });

  const install = (binary: SegmenterBinary) =>
    reader.read(binary).pipe(
      Effect.flatMap((bytes) => segmenterOf(layerSegmenterJieba(bytes))),
      Effect.tap(() =>
        Effect.sync(() => {
          if (loaded && !sameSegmenterBinary(loaded, binary)) {
            logger.warn(
              "The Chinese Segmenter keeps its first binary until the realm restarts",
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
            // The next `resolve` with the same binary tries it again.
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
      if (sameSegmenterBinary(next, requested)) return Effect.undefined;
      requested = next;
      if (next) return install(next);
      logger.info(
        "The Chinese Segmenter is uninstalled; CJK text uses Intl.Segmenter",
      );
      return toNone;
    });

  return { resolve };
}

const segmenterOf = <E>(
  layer: Layer.Layer<Segmenter, E>,
): Effect.Effect<SegmenterService, E> =>
  Effect.provide(Effect.service(Segmenter), layer);
