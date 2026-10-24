import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Queue,
  References,
  Scope,
  Stream,
} from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { settingsOf, settingsRuntimeOf } from "./__fixtures__";
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
      { __VERSION__: 11, "server.hostname": "/on-close" },
    ]);
    expect(closed).toBe(false);
    const duringClose = yield* Effect.exit(
      settings.update({ "server.hostname": "/too-late" }),
    );
    write.resolve();
    yield* Fiber.join(closing);
    expect(closed).toBe(true);
    expect(Exit.isSuccess(duringClose)).toBe(true);
    expect((yield* settings.current)["server.hostname"]).toBe("/on-close");
  }),
);

it.effect("changes emits saved settings and edits in order", () =>
  Effect.gen(function* () {
    const settings = yield* settingsOf({
      plugin: {
        loadData: async () => ({
          __VERSION__: 11,
          "server.hostname": "/saved",
        }),
        saveData: async () => {},
      },
    });
    const changes = yield* Effect.forkChild(
      settings.changes.pipe(Stream.take(2), Stream.runCollect),
      { startImmediately: true },
    );
    yield* settings.loaded;
    yield* settings.update({ "server.hostname": "/edited" });
    const values = yield* Fiber.join(changes);
    expect(values.map((value) => value?.["server.hostname"] ?? null)).toEqual([
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
      expect(writes).toEqual([{ __VERSION__: 11, "server.hostname": "/last" }]);
    }),
);

it.effect(
  "the bridge supplies snapshots, Promises, and an idempotent unsubscribe",
  () =>
    Effect.gen(function* () {
      const { settings, bridge } = yield* settingsRuntimeOf({
        plugin: {
          loadData: async () => ({
            __VERSION__: 11,
            "server.hostname": "/saved",
          }),
          saveData: async () => {},
        },
      });
      const seen: (string | null)[] = [];
      const changed = Promise.withResolvers<void>();
      const stop = bridge.subscribe(settings.changes, (value) => {
        seen.push(value?.["server.hostname"] ?? null);
        if (value?.["server.hostname"] === "/edited") changed.resolve();
      });
      expect(seen).toEqual(["/saved"]);
      yield* Effect.promise(() => bridge.runPromise(settings.loaded));
      bridge.runSync(settings.update({ "server.hostname": "/edited" }));
      expect(bridge.runSync(settings.current)?.["server.hostname"]).toBe(
        "/edited",
      );
      // `loaded` takes its snapshot when it runs, so a run after the edit
      // answers the edited value.
      expect(
        (yield* Effect.promise(() => bridge.runPromise(settings.loaded)))[
          "server.hostname"
        ],
      ).toBe("/edited");
      yield* Effect.promise(() => changed.promise);
      stop();
      stop();
      bridge.runSync(
        settings.update({ "server.hostname": "/after-unsubscribe" }),
      );
      yield* Effect.promise(() => bridge.runPromise(settings.flush()));
      expect(seen).toEqual(["/saved", "/edited"]);
    }),
);

it.effect("scope close stops change subscriptions", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      layerPluginSettings({
        loadData: async () => null,
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
    expect(yield* Fiber.join(changes)).toEqual([yield* settings.current]);
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
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "SettingsPersistenceError",
      cause: failure,
    });
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
  }),
);

it.effect("#1705 a failed read blocks the release check's save", () =>
  Effect.gen(function* () {
    const original = { __VERSION__: 11, "server.hostname": "/saved" };
    let data: unknown = original;
    const settings = yield* settingsOf({
      plugin: {
        loadData: async () => {
          throw new Error("read failed");
        },
        saveData: async (value) => {
          data = value;
        },
      },
    });
    yield* settings.loaded;
    yield* settings.update({ "release.previous-version": "2.2.0" });
    yield* Effect.exit(settings.flush());
    yield* settings.release();
    expect(data).toBe(original);
  }),
);

it.effect("#1705 reload drains an edit queued after it starts waiting", () =>
  Effect.gen(function* () {
    const handoff = {};
    let data: unknown = null;
    const writes = yield* Queue.unbounded<() => void>();
    const plugin = {
      loadData: async () => data,
      saveData: (value: unknown) =>
        new Promise<void>((resolve) => {
          Queue.offerUnsafe(writes, () => {
            data = value;
            resolve();
          });
        }),
    };
    const before = yield* settingsOf({ plugin, handoff });
    yield* before.loaded;
    yield* before.update({ "server.hostname": "/a" });
    yield* before.release();
    const reopening = yield* Effect.forkChild(
      Effect.gen(function* () {
        const after = yield* settingsOf({ plugin, handoff });
        yield* after.loaded;
        return yield* after.current;
      }),
      { startImmediately: true },
    );
    yield* before.update({ "server.hostname": "/b" });
    (yield* Queue.take(writes))();
    (yield* Queue.take(writes))();
    expect((yield* Fiber.join(reopening))?.["server.hostname"]).toBe("/b");
  }),
);

it.effect(
  "#1705 a built settings layer exposes the stored value immediately",
  () =>
    Effect.gen(function* () {
      const settings = yield* settingsOf({
        plugin: {
          loadData: async () => ({
            __VERSION__: 11,
            "server.hostname": "/stored",
          }),
          saveData: async () => {},
        },
      });
      expect((yield* settings.current)?.["server.hostname"]).toBe("/stored");
    }),
);

it.effect("#1705 mutation failures retain their tag and original cause", () =>
  Effect.gen(function* () {
    const settings = yield* settingsOf({
      plugin: { loadData: async () => null, saveData: async () => {} },
    });
    const failure = new Error("patch failed");
    const exit = yield* Effect.exit(
      settings.update(() => {
        throw failure;
      }),
    );
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "SettingsMutationError",
      cause: failure,
    });
  }),
);

it.effect("#1705 migration failures log the original error and stage", () =>
  Effect.gen(function* () {
    const failure = new Error("migration failed");
    const records: Record<string, unknown>[] = [];
    yield* settingsOf({
      plugin: {
        loadData: async () => ({ __VERSION__: 9 }),
        saveData: async () => {},
      },
      migrateV9: () => {
        throw failure;
      },
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ fiber }) => {
            records.push(fiber.getRef(References.CurrentLogAnnotations));
          }),
        ]),
      ),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ error: failure, stage: "v9 migration" }),
    );
  }),
);

it.effect("#1705 a throwing subscriber receives both immediate edits", () =>
  Effect.gen(function* () {
    const { settings, bridge } = yield* settingsRuntimeOf({
      plugin: { loadData: async () => null, saveData: async () => {} },
    });
    const seen: string[] = [];
    const delivered = Promise.withResolvers<void>();
    const stop = bridge.subscribe(settings.changes, (value) => {
      seen.push(value["server.hostname"]);
      if (value["server.hostname"] === "/a") throw new Error("listener failed");
      if (value["server.hostname"] === "/b") delivered.resolve();
    });
    bridge.runSync(settings.update({ "server.hostname": "/a" }));
    bridge.runSync(settings.update({ "server.hostname": "/b" }));
    yield* Effect.promise(() => delivered.promise);
    stop();
    expect(seen.slice(-2)).toEqual(["/a", "/b"]);
  }),
);

it.effect("#1705 bridge calls are safe after whole-runtime disposal", () =>
  Effect.gen(function* () {
    const writes: unknown[] = [];
    const { settings, bridge, close } = yield* settingsRuntimeOf({
      plugin: {
        loadData: async () => ({
          __VERSION__: 11,
          "server.hostname": "/saved",
        }),
        saveData: async (value) => {
          writes.push(value);
        },
      },
    });
    const snapshot = bridge.runSync(settings.current);
    const loading = bridge.runPromise(settings.loaded);
    yield* Effect.promise(close);
    expect(yield* Effect.promise(() => loading)).toEqual(snapshot);
    expect(bridge.runSync(settings.current)).toEqual(snapshot);
    expect(
      yield* Effect.promise(() => bridge.runPromise(settings.loaded)),
    ).toEqual(snapshot);
    expect(bridge.runSync(settings.diagnostics)).toEqual([]);
    expect(bridge.runSync(settings.hydrationOrigin)).toBe("current");
    expect(
      bridge.runSync(settings.update({ "server.hostname": "/late" })),
    ).toEqual(snapshot);
    expect(bridge.runSync(settings.reset())).toEqual(snapshot);
    bridge.runSync(
      settings.updateDefaultLiteratureNoteProfileBindings({
        "note.import-colored-highlights": true,
      }),
    );
    const stop = bridge.subscribe(settings.changes, () => {});
    stop();
    stop();
    bridge.runSync(settings.release());
    yield* Effect.promise(() => bridge.runPromise(settings.flush()));
    expect(writes).toEqual([]);
  }),
);

it.effect("#1705 a failed write leaves flush safe after runtime disposal", () =>
  Effect.gen(function* () {
    const { settings, bridge, close } = yield* settingsRuntimeOf({
      plugin: {
        loadData: async () => null,
        saveData: () => {
          throw new Error("storage closed");
        },
      },
    });
    bridge.runSync(settings.update({ "server.hostname": "/edited" }));
    yield* Effect.promise(() =>
      bridge.runPromise(
        settings.flush().pipe(Effect.catchCause(() => Effect.void)),
      ),
    );
    yield* Effect.promise(close);
    yield* Effect.promise(() =>
      expect(bridge.runPromise(settings.flush())).resolves.toBeUndefined(),
    );
  }),
);
