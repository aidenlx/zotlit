import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App } from "obsidian";
import { expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  DeviceStorage,
  layerDeviceStorage,
  layerDeviceStorageFrom,
} from "@/lib/obsidian-device-storage";

import { MemoryDeviceStorage } from "./__fixtures__/obsidian-device-storage";

it.effect("saves a value and loads it back", () =>
  Effect.gen(function* () {
    const source = new MemoryDeviceStorage();
    const storage = yield* DeviceStorage.pipe(
      Effect.provide(layerDeviceStorageFrom(source)),
    );
    expect(yield* storage.load("key")).toBeNull();
    yield* storage.save("key", { count: 1 });
    expect(yield* storage.load("key")).toEqual({ count: 1 });
    yield* storage.save("key", null);
    expect(source.values.has("key")).toBe(false);
  }),
);

it.effect(
  "fails a throwing call with DeviceStorageError, keeping Obsidian's error",
  () =>
    Effect.gen(function* () {
      const thrown = new Error("Storage is full");
      const app = stubService<App>("App", {
        loadLocalStorage: () => {
          throw thrown;
        },
        saveLocalStorage: () => {
          throw thrown;
        },
      });
      const storage = yield* DeviceStorage.pipe(
        Effect.provide(
          layerDeviceStorage.pipe(
            Layer.provide(Layer.succeed(ObsidianApp, app)),
          ),
        ),
      );
      const load = yield* Effect.flip(storage.load("key"));
      const save = yield* Effect.flip(storage.save("key", 1));
      expect([load.operation, load.key, load.message]).toEqual([
        "loadLocalStorage",
        "key",
        "Storage is full",
      ]);
      expect(load.cause).toBe(thrown);
      expect([save._tag, save.operation]).toEqual([
        "DeviceStorageError",
        "saveLocalStorage",
      ]);
    }),
);
