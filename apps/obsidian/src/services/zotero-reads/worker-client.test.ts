import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { Deferred, Effect, Fiber, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { expect, it } from "@/lib/effect-vitest";
import { plainChineseSegmenter } from "@/services/chinese-segmenter/plain";
import {
  CHINESE_SEGMENTER,
  layerChineseSegmenter,
} from "@/services/chinese-segmenter/service";
import { managedBinaryPorts } from "@/services/managed-binary/platform";
import { ManagedBinaryPlatform } from "@/services/managed-binary/service";
import { memoryDevice } from "@/services/managed-binary/test-utils";
import { settingsMigrations } from "@/services/settings/migrate";
import { SettingsService } from "@/services/settings/service";
import { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { ReadsConfig } from "./rpc";
import { workerClient } from "./worker-client";
import { WORKER_CLOSED } from "./worker-signal";

vi.mock("virtual:zotero-reads-worker", () => ({ default: "" }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: () => Promise.resolve(""),
}));

// #1705: initial searches must use the installed Chinese Segmenter.
it.effect(
  "sends the cached segmenter in the worker's first configuration",
  () =>
    Effect.gen(function* () {
      const firstConfig = yield* Deferred.make<ReadsConfig>();
      const listing = yield* Deferred.make<void>();
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      class WorkerStub extends EventTarget {
        constructor() {
          super();
          queueMicrotask(() =>
            this.dispatchEvent(new MessageEvent("message", { data: [0] })),
          );
        }
        postMessage(
          data: [number, { _tag?: string; value?: ReadsConfig }],
        ): void {
          if (data[1]?._tag === "InitialMessage") {
            run(Deferred.succeed(firstConfig, data[1].value!));
          }
          if (data[0] === 1) {
            queueMicrotask(() =>
              this.dispatchEvent(
                new MessageEvent("message", { data: WORKER_CLOSED }),
              ),
            );
          }
        }
        terminate(): void {}
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => vi.stubGlobal("Worker", WorkerStub)),
        () => Effect.sync(() => vi.unstubAllGlobals()),
      );
      const device = memoryDevice();
      device
        .files(CHINESE_SEGMENTER.id)
        .set(`${CHINESE_SEGMENTER.pin.sha256}.wasm`, new Uint8Array());
      device.consent.saveLocalStorage("zotlit-zotero-paths", {
        profileDir: "/test-profile",
        dataDir: "/test-data",
      });
      const open = yield* Effect.forkChild(
        Effect.promise(async () => {
          await using stack = new AsyncDisposableStack();
          const settings = stack.use(
            new SettingsService({
              ...settingsMigrations,
              plugin: {
                loadData: () => Promise.resolve(null),
                saveData: () => Promise.resolve(),
              },
            }),
          );
          const zoteroPref = stack.use(
            new ZoteroPrefService({ app: device.consent }),
          );
          await Promise.all([settings.ready, zoteroPref.ready]);
          const runtime = buildRuntime(
            layerChineseSegmenter.pipe(
              Layer.provide(
                Layer.succeed(
                  ManagedBinaryPlatform,
                  managedBinaryPorts({
                    ...device,
                    openStore: (directory) => ({
                      ...device.openStore(directory),
                      list: () =>
                        runPromise(
                          Deferred.succeed(listing, undefined).pipe(
                            Effect.andThen(Effect.sleep("1 second")),
                            Effect.as(device.names(directory)),
                          ),
                        ),
                    }),
                    download: () =>
                      Promise.reject(new Error("Unexpected download")),
                  }),
                ),
              ),
            ),
            stack,
          );
          await runtime.context();
          return await runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                yield* workerClient({
                  settings,
                  zoteroPref,
                  chineseSegmenter: plainChineseSegmenter(runtime),
                });
                return yield* Deferred.await(firstConfig);
              }),
            ),
          );
        }),
      );
      yield* Deferred.await(listing);
      yield* TestClock.adjust("1 second");
      expect((yield* Fiber.join(open)).chineseSegmenter).toEqual({
        directory: "chinese-segmenter",
        name: `${CHINESE_SEGMENTER.pin.sha256}.wasm`,
      });
    }).pipe(Effect.scoped),
);
