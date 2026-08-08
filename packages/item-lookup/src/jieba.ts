import { cut, cut_for_search } from "jieba-wasm";

import type { ChsSegmenter } from "./tokenizer";

/**
 * Node-side Jieba segmenter. Internal: not re-exported from the package
 * entrypoint. Intended for bench/test harnesses inside this monorepo.
 *
 * `jieba-wasm`'s node entry loads its wasm synchronously on first use, so
 * no init step is needed.
 */
export const jieba: ChsSegmenter = {
  cut: (text, { search }) =>
    search ? cut_for_search(text, true) : cut(text, true),
};
