import { regex } from "arkregex";
import { Context, Effect, Layer, Schema } from "effect";
import { cut_for_search, initSync } from "jieba-wasm/web";

import { tokenize } from "./tokenizer";

/**
 * Cuts text into search words for the item search engine. The engine reads it
 * once per build and uses the same words for indexing and for queries, so a
 * new Segmenter layer needs a new build.
 */
export class Segmenter extends Context.Service<
  Segmenter,
  {
    /** The search words of `text` in reading order, before normalization. */
    readonly words: (text: string) => string[];
  }
>()("zotlit/item-lookup/Segmenter") {}

/** The Chinese Segmenter binary could not load from the bytes given. */
export class SegmenterUnavailable extends Schema.TaggedError<SegmenterUnavailable>()(
  "SegmenterUnavailable",
  { message: Schema.String },
) {}

/** Word segmentation through `Intl.Segmenter` alone, CJK runs included. */
export const layerSegmenterNone: Layer.Layer<Segmenter> = Layer.sync(
  Segmenter,
  () => {
    const intl = wordSegmenter();
    return { words: (text) => tokenize(text, { intl }) };
  },
);

/**
 * Word segmentation with every CJK run cut by jieba's `cut_for_search` and the
 * rest through `Intl.Segmenter`. `wasm` holds the bytes of the `jieba-wasm` web
 * target binary (`jieba_rs_wasm_bg.wasm`); the caller reads and verifies them.
 */
export function layerSegmenterJieba(
  wasm: BufferSource,
): Layer.Layer<Segmenter, SegmenterUnavailable> {
  return Layer.effect(
    Segmenter,
    Effect.tryPromise({
      try: () => WebAssembly.compile(wasm),
      catch: (cause) => unavailable(cause),
    }).pipe(
      Effect.flatMap((module) =>
        Effect.try({
          try: () => initSync({ module }),
          catch: (cause) => unavailable(cause),
        }),
      ),
      Effect.as(jiebaSegmenter()),
    ),
  );
}

const CJK_RUN = regex("([\\u4e00-\\u9fa5]+)", "u");

/**
 * `cut_for_search` sees each whole CJK run, so it can emit both a compound and
 * its parts (`长江大桥`, `长江`, `大桥`); `Intl.Segmenter` would cut the run first.
 */
function jiebaSegmenter(): (typeof Segmenter)["Service"] {
  const intl = wordSegmenter();
  return {
    words: (text) =>
      // A capturing split puts the CJK runs at the odd positions.
      text
        .split(CJK_RUN)
        .flatMap((part, position) =>
          position % 2 === 1
            ? cut_for_search(part, true)
            : tokenize(part, { intl }),
        ),
  };
}

function wordSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter(undefined, { granularity: "word" });
}

function unavailable(cause: unknown): SegmenterUnavailable {
  return new SegmenterUnavailable({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}
