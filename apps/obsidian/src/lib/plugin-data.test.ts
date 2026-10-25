import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { testPluginData } from "./__fixtures__/plugin-data";
import { layerPluginData, PluginData } from "./plugin-data";

describe("layerPluginData", () => {
  it.effect("loads and saves through the plugin", () =>
    Effect.gen(function* () {
      let saved: unknown = { theme: "dark" };
      const data = yield* PluginData.pipe(
        Effect.provide(
          layerPluginData({
            loadData: async () => saved,
            saveData: async (value: unknown) => {
              saved = value;
            },
          }),
        ),
      );

      expect(yield* data.load).toEqual({ theme: "dark" });
      yield* data.save({ theme: "light" });
      expect(saved).toEqual({ theme: "light" });
    }),
  );

  it.effect("fails with what Obsidian threw as the cause", () =>
    Effect.gen(function* () {
      const disk = new Error("EACCES: permission denied");
      const data = yield* PluginData.pipe(
        Effect.provide(
          layerPluginData({
            loadData: () => Promise.reject(disk),
            saveData: () => Promise.reject(disk),
          }),
        ),
      );

      const load = yield* Effect.flip(data.load);
      const save = yield* Effect.flip(data.save({}));
      expect(load).toMatchObject({ _tag: "UnknownError", cause: disk });
      expect(save).toMatchObject({ _tag: "UnknownError", cause: disk });
    }),
  );
});

describe("testPluginData", () => {
  it.effect("keeps what was saved for the next load", () =>
    Effect.gen(function* () {
      const data = testPluginData({ version: 1 });

      yield* data.service.save({ version: 2 });
      expect(yield* data.service.load).toEqual({ version: 2 });
      expect(data.store.saved).toEqual([{ version: 2 }]);
    }),
  );
});
