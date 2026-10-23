import { TestClock } from "effect/testing";

import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
  Stream,
} from "@/lib/effect";
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

// #1705: each binary releases startup while cache discovery remains pending.
for (const declined of [false, true]) {
  it.effect(
    `bounds cache discovery and publishes late binaries (declined: ${declined})`,
    () =>
      Effect.gen(function* () {
        const started = yield* Queue.unbounded<string>();
        const result = yield* Deferred.make<void>();
        const device = memoryDevice();
        const binaries = [CHINESE_SEGMENTER, PANDOC_ENGINE];
        for (const binary of binaries) {
          device
            .files(binary.id)
            .set(`${binary.pin.sha256}.wasm`, new Uint8Array());
          device.consent.saveLocalStorage(
            `zotlit-${binary.id}-declined`,
            declined,
          );
        }
        const ports = managedBinaryPorts({
          ...device,
          download: () => Promise.reject(new Error("Unexpected download")),
        });
        const layer = Layer.mergeAll(
          layerChineseSegmenter,
          layerPandocEngine,
        ).pipe(
          Layer.provide(
            Layer.succeed(ManagedBinaryPlatform, {
              ...ports,
              openStore: (directory) =>
                ports.openStore(directory).pipe(
                  Effect.map((store) => ({
                    ...store,
                    list: () =>
                      Queue.offer(started, directory).pipe(
                        Effect.andThen(Deferred.await(result)),
                        Effect.as(device.names(directory)),
                      ),
                  })),
                ),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          let built = false;
          const first = yield* Layer.build(layer).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                built = true;
              }),
            ),
            Effect.forkChild,
          );
          yield* Queue.take(started);
          yield* Queue.take(started);
          yield* TestClock.adjust("5 seconds");
          expect(built).toBe(true);
          const context = yield* Fiber.join(first);
          const services = [
            Context.get(context, ChineseSegmenter),
            Context.get(context, PandocEngine),
          ];
          const subscribers = yield* Effect.forEach(services, (service) =>
            Stream.toPull(service.changes),
          );
          for (const changes of subscribers)
            expect((yield* changes)[0]).toEqual({
              kind: declined ? "declined" : "absent",
            });
          yield* Deferred.succeed(result, undefined);
          for (const [index, changes] of subscribers.entries()) {
            const binary = binaries[index]!;
            expect((yield* changes)[0]).toEqual({
              kind: "installed",
              version: binary.pin.version,
              binary: {
                directory: binary.id,
                name: `${binary.pin.sha256}.wasm`,
              },
            });
          }
        }).pipe(Effect.ensuring(Deferred.succeed(result, undefined)));
      }),
  );
}

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
