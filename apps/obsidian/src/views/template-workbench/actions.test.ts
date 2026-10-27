// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Logger, References } from "effect";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError } from "@/lib/legacy-port";
import { Notifier } from "@/lib/notifier";

import { templateWorkbenchAction } from "./actions";

/** The notices and error logs one action leaves. */
function recorder() {
  const notifier = testNotifier();
  const errors: unknown[] = [];
  return {
    notices: () => notifier.notices.map((notice) => notice.messages),
    errors,
    layer: Layer.merge(
      Layer.succeed(Notifier, notifier.service),
      Logger.layer([
        Logger.make(({ logLevel, fiber }) => {
          if (logLevel === "Error")
            errors.push(fiber.getRef(References.CurrentLogAnnotations));
        }),
      ]),
    ),
  };
}

it.effect("shows nothing when the action succeeds", () =>
  Effect.gen(function* () {
    const record = recorder();
    yield* templateWorkbenchAction("open-editor", Effect.void).pipe(
      Effect.provide(record.layer),
    );
    expect(record.notices()).toEqual([]);
    expect(record.errors).toEqual([]);
  }),
);

it.effect("logs a failed action under its operation and shows a notice", () =>
  Effect.gen(function* () {
    const record = recorder();
    yield* templateWorkbenchAction(
      "open-editor",
      Effect.fail(new LegacyPortError({ step: "open", cause: "disk full" })),
    ).pipe(Effect.provide(record.layer));
    expect(record.notices()).toEqual([[m.notice_profile_action_failed()]]);
    expect(record.errors).toMatchObject([{ operation: "open-editor" }]);
  }),
);

// #1819: an unpack or restore that unload stops is released quietly.
it.effect.each(["interrupt", "abort"] as const)(
  "releases an action stopped by %s without a notice or an error log",
  (reason) =>
    Effect.gen(function* () {
      const record = recorder();
      const fiber = yield* templateWorkbenchAction(
        "unpack-partials",
        reason === "interrupt"
          ? Effect.never
          : Effect.fail(
              new LegacyPortError({ step: "unpack", cause: new AbortError() }),
            ),
      ).pipe(Effect.provide(record.layer), Effect.forkChild);
      yield* Effect.yieldNow;
      if (reason === "interrupt") yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(reason === "interrupt");
      expect(record.notices()).toEqual([]);
      expect(record.errors).toEqual([]);
    }),
);
