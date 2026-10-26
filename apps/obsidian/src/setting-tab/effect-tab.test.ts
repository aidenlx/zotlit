import { expect, it } from "@effect/vitest";
import { Data, Deferred, Effect } from "effect";

import { testSettingTab } from "./__fixtures__";

class DiskFull extends Data.TaggedError("DiskFull")<{ message: string }> {}

it.effect(
  "shows a failed handler as a notice under its label and still settles",
  () =>
    Effect.gen(function* () {
      const { tab, notices } = testSettingTab();
      yield* Effect.promise(() =>
        tab.run(
          Effect.fail(new DiskFull({ message: "disk full" })),
          "Cannot save",
        ),
      );
      expect(notices.map((notice) => notice.messages[0])).toEqual([
        "Cannot save: disk full",
      ]);
    }),
);

it.effect("ends an interrupted handler without a notice", () =>
  Effect.gen(function* () {
    const { tab, notices } = testSettingTab();
    yield* Effect.promise(() => tab.run(Effect.interrupt, "Cannot save"));
    expect(notices).toEqual([]);
  }),
);

it.effect("closes a live row's Scope when its cleanup runs", () =>
  Effect.gen(function* () {
    const { tab } = testSettingTab();
    const started = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    const cleanup = tab.mount(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }),
    );
    yield* Deferred.await(started);
    cleanup();
    yield* Deferred.await(closed);
  }),
);
