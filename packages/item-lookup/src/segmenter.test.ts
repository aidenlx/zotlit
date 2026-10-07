import { Effect, Stream } from "effect";
import type { Layer } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { buildEngineIndex, searchEngineIndex } from "./engine";
import { makeIndexedItem as item } from "./fixtures";
import {
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
  SegmenterUnavailable,
} from "./segmenter";

// The web target binary, as the Chinese Segmenter download delivers it.
const JIEBA_WASM = readFileSync(
  fileURLToPath(
    new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
  ),
);

const TITLE = "中华人民共和国宪法研究";

describe("segmenter layers", () => {
  it("cut a CJK title differently", async () => {
    const none = await wordsOf(TITLE, layerSegmenterNone);
    const jieba = await wordsOf(TITLE, layerSegmenterJieba(JIEBA_WASM));

    expect(none).not.toContain("华人");
    expect(jieba).toEqual(
      expect.arrayContaining(["华人", "中华人民共和国宪法"]),
    );
  });

  it("let a query over jieba words hit only through the jieba layer", async () => {
    const target = item({ key: "A", title: TITLE });
    const search = (layer: Layer.Layer<Segmenter, SegmenterUnavailable>) =>
      Effect.gen(function* () {
        const index = yield* buildEngineIndex(Stream.make([target]), {
          libraries: [USER_LIBRARY_ID],
        });
        return yield* searchEngineIndex(index, "华人", 50);
      }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(await search(layerSegmenterNone)).toEqual([]);
    expect(
      (await search(layerSegmenterJieba(JIEBA_WASM))).map((hit) => hit.itemID),
    ).toEqual([target.itemID]);
  });

  it("fail with SegmenterUnavailable on bytes that are not the binary", async () => {
    const error = await Effect.flip(
      wordsOfEffect(TITLE, layerSegmenterJieba(new Uint8Array([1, 2, 3]))),
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(SegmenterUnavailable);
  });
});

function wordsOfEffect(
  text: string,
  layer: Layer.Layer<Segmenter, SegmenterUnavailable>,
) {
  return Effect.map(Effect.service(Segmenter), ({ words }) => words(text)).pipe(
    Effect.provide(layer),
  );
}

function wordsOf(
  text: string,
  layer: Layer.Layer<Segmenter, SegmenterUnavailable>,
): Promise<string[]> {
  return Effect.runPromise(wordsOfEffect(text, layer));
}
