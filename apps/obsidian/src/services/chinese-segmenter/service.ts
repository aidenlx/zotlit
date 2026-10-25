// The Chinese Segmenter as a Managed Binary: the pinned web-target `jieba-wasm` binary.

import { Context } from "effect";

import { layerManagedBinary } from "@/services/managed-binary/service";
import type {
  ManagedBinary,
  ManagedBinaryApi,
} from "@/services/managed-binary/service";

/**
 * The verified binary, compiled. The ZoteroReads worker instantiates the
 * segmenter itself from the bytes in the device-wide store; the renderer
 * compiles them only to prove they start.
 */
export interface ChineseSegmenterModule extends Disposable {
  readonly module: WebAssembly.Module;
}

/** The Chinese Segmenter's declaration; its cache is `zotlit/chinese-segmenter`. */
export const CHINESE_SEGMENTER: ManagedBinary<ChineseSegmenterModule> = {
  id: "chinese-segmenter",
  label: "Chinese segmenter",
  logCategory: ["item-lookup", "segmenter"],
  pin: __CHINESE_SEGMENTER__,
  createEngine: async (binary) => ({
    module: await WebAssembly.compileStreaming(
      new Response(binary, { headers: { "content-type": "application/wasm" } }),
    ),
    // A compiled module holds no instance and no memory to release.
    [Symbol.dispose]: () => undefined,
  }),
  startOnInstall: true,
};

export class ChineseSegmenter extends Context.Service<
  ChineseSegmenter,
  ManagedBinaryApi<ChineseSegmenterModule>
>()("zotlit/chinese-segmenter/ChineseSegmenter") {}

export const layerChineseSegmenter = layerManagedBinary(
  ChineseSegmenter,
  CHINESE_SEGMENTER,
);
