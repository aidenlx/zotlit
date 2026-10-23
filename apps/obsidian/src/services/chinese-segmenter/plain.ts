// ChineseSegmenter for consumers outside Effect.
import type { ManagedRuntime } from "@/lib/effect";
import { plainManagedBinary } from "@/services/managed-binary/plain";
import type { PlainManagedBinary } from "@/services/managed-binary/plain";

import { ChineseSegmenter } from "./service";
import type { ChineseSegmenterModule } from "./service";

export type PlainChineseSegmenter = PlainManagedBinary<ChineseSegmenterModule>;

export function plainChineseSegmenter(
  runtime: ManagedRuntime.ManagedRuntime<ChineseSegmenter, never>,
): PlainChineseSegmenter {
  return plainManagedBinary(runtime, runtime.runSync(ChineseSegmenter));
}
