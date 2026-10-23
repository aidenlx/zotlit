import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { settingsOf, plainSettingsOf } from "./__fixtures__";
import { layerPluginSettings, PluginSettings } from "./service";

// A pending edit must reach disk before the settings scope finishes closing.
it.effect("scope close flushes a pending edit and waits for its write", () =>
  Effect.gen(function* () {
    const write = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const writes: unknown[] = [];
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      layerPluginSettings({
        loadData: async () => null,
        saveData: (data) => {
          writes.push(data);
          started.resolve();
          return write.promise;
        },
      }),
      scope,
    );
    const settings = Context.get(context, PluginSettings);
    yield* settings.loaded;
    yield* settings.update({ "server.hostname": "/on-close" });
    let closed = false;
    const closing = yield* Effect.forkChild(
      Scope.close(scope, Exit.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            closed = true;
          }),
        ),
      ),
      { startImmediately: true },
    );
    yield* Effect.promise(() => started.promise);
    expect(writes).toEqual([
      { __VERSION__: 10, "server.hostname": "/on-close" },
    ]);
    expect(closed).toBe(false);
    const duringClose = yield* Effect.exit(
      settings.update({ "server.hostname": "/too-late" }),
    );
    write.resolve();
    yield* Fiber.join(closing);
    expect(closed).toBe(true);
    expect(Exit.isFailure(duringClose)).toBe(true);
  }),
);

it.effect("changes emits loading, saved settings, and edits in order", () =>
  Effect.gen(function* () {
    const read = Promise.withResolvers<unknown>();
    const settings = yield* settingsOf({
      plugin: {
        loadData: () => read.promise,
        saveData: async () => {},
      },
    });
    const changes = yield* Effect.forkChild(
      settings.changes.pipe(Stream.take(3), Stream.runCollect),
      { startImmediately: true },
    );
    read.resolve({ __VERSION__: 10, "server.hostname": "/saved" });
    yield* settings.loaded;
    yield* settings.update({ "server.hostname": "/edited" });
    const values = yield* Fiber.join(changes);
    expect(values.map((value) => value?.["server.hostname"] ?? null)).toEqual([
      null,
      "/saved",
      "/edited",
    ]);
  }),
);

it.effect(
  "debounces edits on the Clock and writes only the last snapshot",
  () =>
    Effect.gen(function* () {
      const saved = Promise.withResolvers<void>();
      const writes: unknown[] = [];
      const settings = yield* settingsOf({
        plugin: {
          loadData: async () => null,
          saveData: async (value) => {
            writes.push(value);
            saved.resolve();
          },
        },
      });
      yield* settings.loaded;
      yield* settings.update({ "server.hostname": "/first" });
      yield* TestClock.adjust(199);
      expect(writes).toEqual([]);
      yield* settings.update({ "server.hostname": "/last" });
      yield* TestClock.adjust(199);
      expect(writes).toEqual([]);
      yield* TestClock.adjust(1);
      yield* Effect.promise(() => saved.promise);
      yield* settings.flush();
      expect(writes).toEqual([{ __VERSION__: 10, "server.hostname": "/last" }]);
    }),
);

it.effect(
  "the adapter supplies snapshots, Promises, and an idempotent unsubscribe",
  () =>
    Effect.gen(function* () {
      const read = Promise.withResolvers<unknown>();
      const settings = yield* plainSettingsOf({
        plugin: {
          loadData: () => read.promise,
          saveData: async () => {},
        },
      });
      const seen: (string | null)[] = [];
      const changed = Promise.withResolvers<void>();
      const stop = settings.subscribe((value) => {
        seen.push(value?.["server.hostname"] ?? null);
        if (value?.["server.hostname"] === "/edited") changed.resolve();
      });
      expect(seen).toEqual([null]);
      read.resolve({ __VERSION__: 10, "server.hostname": "/saved" });
      yield* Effect.promise(() => settings.loaded);
      const latest = settings.loaded;
      settings.update({ "server.hostname": "/edited" });
      expect(settings.current?.["server.hostname"]).toBe("/edited");
      expect((yield* Effect.promise(() => latest))["server.hostname"]).toBe(
        "/edited",
      );
      yield* Effect.promise(() => changed.promise);
      stop();
      stop();
      settings.update({ "server.hostname": "/after-unsubscribe" });
      yield* Effect.promise(() => settings.flush());
      expect(seen).toEqual([null, "/saved", "/edited"]);
    }),
);

it.effect(
  "scope close stops change subscriptions and cancels a pending load",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const read = Promise.withResolvers<unknown>();
      const context = yield* Layer.buildWithScope(
        layerPluginSettings({
          loadData: () => read.promise,
          saveData: async () => {},
        }),
        scope,
      );
      const settings = Context.get(context, PluginSettings);
      const changes = yield* Effect.forkChild(
        Stream.runCollect(settings.changes),
        { startImmediately: true },
      );
      yield* Scope.close(scope, Exit.void);
      read.resolve({ __VERSION__: 10, "server.hostname": "/too-late" });
      expect(yield* Fiber.join(changes)).toEqual([null]);
      expect(yield* settings.current).toBeNull();
    }),
);

it.effect("flush preserves a synchronous storage failure", () =>
  Effect.gen(function* () {
    const failure = new Error("write failed before returning a Promise");
    const settings = yield* settingsOf({
      plugin: {
        loadData: async () => null,
        saveData: () => {
          throw failure;
        },
      },
    });
    yield* settings.loaded;
    yield* settings.update({ "server.hostname": "/failure" });
    const exit = yield* Effect.exit(settings.flush());
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
  }),
);
