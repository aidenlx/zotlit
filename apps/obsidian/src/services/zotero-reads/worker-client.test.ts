import { RpcGroup, RpcServer, RpcWorker } from "effect/rpc";
import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import { Effect, Fiber, Layer, Queue, Stream } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { CHINESE_SEGMENTER } from "@/services/chinese-segmenter/service";
import { ManagedBinaryService } from "@/services/managed-binary/service";
import { memoryDevice } from "@/services/managed-binary/test-utils";
import { plainSettingsOf } from "@/services/settings/__fixtures__";
import { settingsMigrations } from "@/services/settings/migrate";
import { zoteroPrefFixture } from "@/services/zotero-pref/__fixtures__";
import { plainZoteroPref } from "@/services/zotero-pref/plain";

import { WorkerInitSchema, ZoteroReads } from "./rpc";
import type { ReadsConfig } from "./rpc";
import { workerClient } from "./worker-client";
import { launchWorker } from "./worker-launch";

vi.mock("virtual:zotero-reads-worker", () => ({ default: "" }));

/** A controlled browser process boundary with the real worker RPC protocol. */
const workerFixture = Effect.fn("workerFixture")(function* () {
  const spawned = yield* Queue.unbounded<StandInWorker>();
  const configured = yield* Queue.unbounded<ReadsConfig>();
  const initial = yield* Queue.unbounded<ReadsConfig>();
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const group = RpcGroup.make(
    ...Array.from(ZoteroReads.requests.values()).filter(
      (rpc) =>
        rpc._tag === "Configure" ||
        rpc._tag === "Changes" ||
        rpc._tag === "Ping",
    ),
  );
  class StandInWorker extends EventTarget {
    readonly endpoint = new EventTarget();
    readonly pending: unknown[] = [];
    listening = false;
    constructor() {
      super();
      run(Queue.offer(spawned, this));
    }
    start() {
      launchWorker(
        {
          addEventListener: this.endpoint.addEventListener.bind(this.endpoint),
          removeEventListener: this.endpoint.removeEventListener.bind(
            this.endpoint,
          ),
          postMessage: (data) => {
            this.dispatchEvent(new MessageEvent("message", { data }));
            if (Array.isArray(data) && data[0] === 0) {
              this.listening = true;
              for (const message of this.pending.splice(0))
                this.postMessage(message);
            }
          },
          close: () => undefined,
        },
        RpcServer.layer(group).pipe(
          Layer.provide(
            Layer.unwrap(
              RpcWorker.initialMessage(WorkerInitSchema).pipe(
                Effect.orDie,
                Effect.tap((config) => Queue.offer(initial, config)),
                Effect.as(
                  group.toLayer({
                    Configure: (config) =>
                      Queue.offer(configured, config).pipe(Effect.asVoid),
                    Changes: () => Stream.never,
                    Ping: () => Effect.void,
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    }
    postMessage(data: unknown) {
      if (!this.listening) this.pending.push(data);
      else
        queueMicrotask(() =>
          this.endpoint.dispatchEvent(new MessageEvent("message", { data })),
        );
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", StandInWorker);
  yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllGlobals()));
  const settings = yield* plainSettingsOf({
    plugin: { loadData: async () => null, saveData: async () => undefined },
    ...settingsMigrations,
  });
  const device = memoryDevice();
  const chineseSegmenter = yield* acquireAsyncDisposable(
    async () =>
      new ManagedBinaryService(CHINESE_SEGMENTER, {
        ...device,
        download: async () => {
          throw new Error("Unexpected download");
        },
      }),
  );
  return { spawned, configured, initial, settings, chineseSegmenter };
});

// #1705: a delayed prefs.js must settle before the worker receives its first configuration.
it.effect("starts the worker with the loaded profile data directory", () =>
  Effect.gen(function* () {
    const worker = yield* workerFixture();
    const started = yield* Queue.unbounded<void>();
    const opening = yield* zoteroPrefFixture(() =>
      Queue.offer(started, undefined).pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.as(
          'user_pref("extensions.zotero.useDataDir", true);\nuser_pref("extensions.zotero.dataDir", "/research-data");',
        ),
      ),
    ).pipe(
      Effect.flatMap((f) =>
        workerClient({ ...worker, zoteroPref: plainZoteroPref(f.runtime) }),
      ),
      Effect.forkChild,
    );
    yield* Queue.take(started);
    yield* TestClock.adjust("1 second");
    (yield* Queue.take(worker.spawned)).start();
    yield* Fiber.join(opening);
    expect((yield* Queue.take(worker.initial)).databasePath).toBe(
      "/research-data/zotero.sqlite",
    );
    worker.settings.update({ "zotero.auto-refresh": false });
    expect((yield* Queue.take(worker.configured)).databasePath).toBe(
      "/research-data/zotero.sqlite",
    );
  }),
);

// #1705: an override written during the connection wait must reach the worker.
it.effect(
  "reconciles preferences changed during the worker connection wait",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient({
        ...worker,
        zoteroPref: plainZoteroPref(f.runtime),
      }).pipe(Effect.forkChild);
      const spawned = yield* Queue.take(worker.spawned);
      yield* f.pref.setDataDir("/changed-during-connect");
      spawned.start();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.configured)).databasePath).toBe(
        "/changed-during-connect/zotero.sqlite",
      );
    }),
);
