// The Chinese Segmenter as a Managed Binary: the pinned web-target `jieba-wasm` binary.

import type { App } from "obsidian";

import {
  ManagedBinaryService,
  obsidianBinaryPorts,
} from "@/services/managed-binary/service";
import type { ManagedBinary } from "@/services/managed-binary/service";

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

export type ChineseSegmenterService =
  ManagedBinaryService<ChineseSegmenterModule>;

/** The service over Obsidian's own ports: `requestUrl` and the origin's OPFS. */
export function createChineseSegmenterService(
  app: App,
): ChineseSegmenterService {
  return new ManagedBinaryService(CHINESE_SEGMENTER, obsidianBinaryPorts(app));
}
