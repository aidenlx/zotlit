import { TestClock } from "effect/testing";

import { Context, Effect, Fiber, Layer } from "@/lib/effect";
import { expect, it } from "@/lib/effect-vitest";
import {
  CHINESE_SEGMENTER,
  ChineseSegmenter,
  layerChineseSegmenter,
} from "@/services/chinese-segmenter/service";
import { managedBinaryPorts } from "@/services/managed-binary/platform";
import {
  layerPandocEngine,
  PANDOC_ENGINE,
  PandocEngine,
} from "@/services/pandoc/service";

import { ManagedBinaryPlatform } from "./service";
import { memoryDevice } from "./test-utils";

// #1705: a built layer must include cache discovery in its startup barrier.
it.effect(
  "reports both cached binaries on the first read after layer build",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = memoryDevice();
        for (const binary of [CHINESE_SEGMENTER, PANDOC_ENGINE]) {
          device
            .files(binary.id)
            .set(`${binary.pin.sha256}.wasm`, new Uint8Array());
        }
        const runPromise = Effect.runPromiseWith(
          yield* Effect.context<never>(),
        );
        const layer = Layer.mergeAll(
          layerChineseSegmenter,
          layerPandocEngine,
        ).pipe(
          Layer.provide(
            Layer.succeed(
              ManagedBinaryPlatform,
              managedBinaryPorts({
                ...device,
                openStore: (directory) => ({
                  ...device.openStore(directory),
                  list: () =>
                    runPromise(
                      Effect.sleep("1 second").pipe(
                        Effect.as(device.names(directory)),
                      ),
                    ),
                }),
                download: () =>
                  Promise.reject(new Error("Unexpected download")),
              }),
            ),
          ),
        );
        const firstRead = yield* Effect.forkChild(
          Effect.gen(function* () {
            const context = yield* Layer.build(layer);
            return [
              yield* Context.get(context, ChineseSegmenter).getStatus(),
              yield* Context.get(context, PandocEngine).getStatus(),
            ];
          }),
        );
        yield* TestClock.adjust("1 second");
        expect(
          (yield* Fiber.join(firstRead)).map((status) => status.kind),
        ).toEqual(["installed", "installed"]);
      }),
    ),
);
