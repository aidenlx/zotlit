import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { Command } from "obsidian";
import { describe, expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { layerDatabaseActions } from "./actions";

const REFRESH_COMMAND = "refresh-zotero-data";

/** `refresh` runs each time the refresh Effect runs, so a spy counts the runs. */
function layerCommand(refresh: () => ZoteroReads["Service"]["refresh"]) {
  return Effect.gen(function* () {
    const host = testPluginHost();
    const notifier = testNotifier();
    const reads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
      refresh: Effect.suspend(refresh),
    });

    yield* Layer.build(
      layerDatabaseActions.pipe(
        Layer.provide(
          Layer.mergeAll(
            host.layer,
            notifier.layer,
            Layer.succeed(ZoteroReads, reads),
          ),
        ),
      ),
    );

    const command = host.commands.get(REFRESH_COMMAND);
    if (!command) throw new Error(`${REFRESH_COMMAND} was not registered`);
    return { command, notices: notifier.notices };
  });
}

async function run(command: Command): Promise<void> {
  if (!command.callback) throw new Error("The command has no callback");
  await command.callback();
}

describe("database refresh action", () => {
  it.effect("registers the command and refreshes once when run", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() => Effect.void);
      const { command } = yield* layerCommand(refresh);

      expect(command.id).toBe(REFRESH_COMMAND);
      expect(refresh).not.toHaveBeenCalled();
      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("swallows DbUnavailable", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() =>
        Effect.fail(new DbUnavailable({ message: "database unavailable" })),
      );
      const { command } = yield* layerCommand(refresh);

      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("swallows an interrupted refresh", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() => Effect.interrupt);
      const { command } = yield* layerCommand(refresh);

      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("rethrows any other error", () =>
    Effect.gen(function* () {
      const failure = new Error("refresh failed");
      const { command } = yield* layerCommand(() => Effect.die(failure));

      const error = yield* Effect.promise(() =>
        run(command).then(
          () => null,
          (error: unknown) => error,
        ),
      );
      expect(error).toBe(failure);
    }),
  );

  it.effect("shows no loading notice for a refresh done within 200 ms", () =>
    Effect.gen(function* () {
      const { command, notices } = yield* layerCommand(() => Effect.void);

      yield* Effect.promise(() => run(command));
      yield* TestClock.adjust("200 millis");
      expect(notices).toEqual([
        {
          messages: ["Zotero database refreshed."],
          duration: 0,
          hidden: false,
        },
      ]);
      yield* TestClock.adjust("2 seconds");
      expect(notices[0]?.hidden).toBe(true);
    }),
  );

  it.effect(
    "shows the loading notice for a slow refresh, then its result",
    () =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        const { command, notices } = yield* layerCommand(() =>
          Deferred.await(done),
        );

        const running = yield* Effect.promise(() => run(command)).pipe(
          Effect.forkChild,
        );
        yield* TestClock.adjust("200 millis");
        expect(notices).toEqual([
          {
            messages: ["Refreshing Zotero database…"],
            duration: 0,
            hidden: false,
          },
        ]);
        yield* Deferred.succeed(done, undefined);
        yield* Effect.yieldNow;
        expect(notices[0]?.messages.at(-1)).toBe("Zotero database refreshed.");
        yield* TestClock.adjust("2 seconds");
        expect(notices[0]?.hidden).toBe(true);
        yield* Fiber.join(running);
      }),
  );

  it.effect("shows the failure for 4 seconds", () =>
    Effect.gen(function* () {
      const { command, notices } = yield* layerCommand(() =>
        Effect.fail(new DbUnavailable({ message: "database unavailable" })),
      );

      yield* Effect.promise(() => run(command));
      yield* Effect.yieldNow;
      expect(notices).toEqual([
        {
          messages: ["Failed to refresh Zotero database."],
          duration: 0,
          hidden: false,
        },
      ]);
      yield* TestClock.adjust("3999 millis");
      expect(notices[0]?.hidden).toBe(false);
      yield* TestClock.adjust("1 millis");
      expect(notices[0]?.hidden).toBe(true);
    }),
  );
});
