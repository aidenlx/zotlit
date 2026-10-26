// A device for the Language Pack: Obsidian's storage, its language, and the
// network, all in memory.
import { Context, Effect, Exit, Layer } from "effect";
import type { App } from "obsidian";

import { layerFakeFetch } from "@/lib/__fixtures__/fake-fetch";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerDeviceStorageFrom } from "@/lib/obsidian-device-storage";
import { ObsidianEnv } from "@/lib/obsidian-env";

import { LanguagePack, layerLanguagePack, startLanguagePack } from "./service";

/** A valid zh-CN pack, overriding Messages the tests read through `m.*`. */
export const CHINESE_PACK = JSON.stringify({
  schemaVersion: 1,
  locale: "zh-CN",
  messages: { hello: "世界（测试）", workbench_tab_match: "匹配（测试包）" },
});

export interface FakeDevice {
  /** Obsidian's device storage, shared by every start on this device. */
  readonly storage: Map<string, unknown>;
  /** Every URL downloaded, in order. */
  readonly requests: string[];
  /** Obsidian's storage, replaced by a test that makes it throw. */
  loadLocalStorage: App["loadLocalStorage"];
  saveLocalStorage: App["saveLocalStorage"];
  /** What the network answers: a body, a status with a body, or a dropped connection. */
  answer: string | { status: number; text: string } | Error;
  /** While set, the network answers once this settles. */
  held?: Promise<unknown>;
}

export function fakeDevice(
  answer: FakeDevice["answer"] = CHINESE_PACK,
): FakeDevice {
  const storage = new Map<string, unknown>();
  return {
    storage,
    requests: [],
    answer,
    loadLocalStorage: (key) => storage.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) storage.delete(key);
      else storage.set(key, value);
    },
  };
}

/**
 * Start the plugin on `device` with Obsidian in `language`, as `onload` does:
 * the startup that applies the cached pack, then the LanguagePack layer, built
 * in the test's Scope.
 */
export const startOn = Effect.fn("test.startOn")(function* (
  device: FakeDevice,
  {
    language,
    pluginVersion = "2.0.0",
  }: {
    language: string;
    pluginVersion?: string;
  },
) {
  const storage = layerDeviceStorageFrom(device);
  const startup = yield* startLanguagePack(pluginVersion).pipe(
    Effect.provide(
      Layer.merge(
        storage,
        Layer.succeed(
          ObsidianEnv,
          stubService<ObsidianEnv["Service"]>("ObsidianEnv", { language }),
        ),
      ),
    ),
  );
  const context = yield* Layer.build(
    layerLanguagePack(startup).pipe(
      Layer.provide(storage),
      Layer.provide(
        layerFakeFetch(async (input) => {
          device.requests.push(
            input instanceof Request ? input.url : String(input),
          );
          await device.held;
          const { answer } = device;
          if (answer instanceof Error) throw answer;
          return typeof answer === "string"
            ? new Response(answer)
            : new Response(answer.text, { status: answer.status });
        }),
      ),
    ),
  );
  return Context.get(context, LanguagePack);
});

/**
 * Yield until `assert` passes, for a forked fiber (a toast) to take in what
 * just happened. After a bounded number of turns, the case dies with the last
 * assertion failure.
 */
export const eventually = (assert: () => void) =>
  Effect.yieldNow.pipe(
    Effect.andThen(Effect.exit(Effect.sync(assert))),
    Effect.repeat({ until: Exit.isSuccess, times: 1000 }),
    Effect.flatten,
  );
