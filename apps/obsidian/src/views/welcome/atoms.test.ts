// Welcome commands keep saved banner choices and give each leaf its own conversion.
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";
import { PluginSettings } from "@/services/settings/service";
import { TemplateMigration } from "@/services/template/migration";

import { makeWelcomeHost, waitFor } from "./__fixtures__";
import {
  dismissWelcomeCommand,
  keepWelcomeCommand,
  makeConversionCommand,
} from "./atoms";

it.effect("saves a banner request and folds its saved steps on dismissal", () =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireDisposable(
      Effect.promise(() => makeWelcomeHost()),
    );
    const { registry } = host;
    const settings = yield* Effect.provideContext(PluginSettings, host.context);
    const releases = [
      registry.mount(keepWelcomeCommand),
      registry.mount(dismissWelcomeCommand),
    ];
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const release of releases) release();
      }),
    );
    registry.set(keepWelcomeCommand, {
      "welcome.dismissed": false,
      "welcome.requested": true,
      "welcome.steps-shown": true,
    });
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(registry.get(keepWelcomeCommand).waiting).toBe(false),
      ),
    );
    expect((yield* settings.current)["welcome.requested"]).toBe(true);
    expect((yield* settings.current)["welcome.steps-shown"]).toBe(true);
    registry.set(dismissWelcomeCommand, undefined);
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(registry.get(dismissWelcomeCommand).waiting).toBe(false),
      ),
    );
    expect((yield* settings.current)["welcome.dismissed"]).toBe(true);
    expect((yield* settings.current)["welcome.requested"]).toBe(false);
    expect((yield* settings.current)["welcome.steps-shown"]).toBe(false);
  }),
);

it.effect(
  "one leaf's conversion leaves another running and closes with its leaf, with no notice",
  () =>
    Effect.gen(function* () {
      let started = 0;
      let cancelled = 0;
      const notifier = testNotifier();
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeWelcomeHost({
            services: Layer.mergeAll(
              notifier.layer,
              Layer.mock(TemplateMigration, {
                convert: Effect.gen(function* () {
                  started += 1;
                  return yield* Effect.never;
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      cancelled += 1;
                    }),
                  ),
                ),
              }),
            ),
          }),
        ),
      );
      const first = makeConversionCommand();
      const second = makeConversionCommand();
      const stopFirst = host.registry.mount(first);
      const stopSecond = host.registry.mount(second);
      host.registry.set(first, { retry: false });
      host.registry.set(second, { retry: false });
      yield* Effect.promise(() => waitFor(() => expect(started).toBe(2)));
      stopFirst();
      yield* Effect.promise(() => waitFor(() => expect(cancelled).toBe(1)));
      expect(host.registry.get(second).waiting).toBe(true);
      stopSecond();
      yield* Effect.promise(() => waitFor(() => expect(cancelled).toBe(2)));
      expect(notifier.notices).toEqual([]);
    }),
);

it.effect.each([false, true])(
  "reports the conversion result once through Notifier (retry: %s)",
  (retry) =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const converted = {
        outcome: "converted" as const,
        document: null,
        trashed: [],
        pendingCleanup: [],
        kept: [],
      };
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeWelcomeHost({
            services: Layer.mergeAll(
              notifier.layer,
              Layer.mock(TemplateMigration, {
                convert: Effect.succeed(converted),
                retryCleanup: Effect.succeed(converted),
              }),
            ),
          }),
        ),
      );
      const command = makeConversionCommand();
      const stop = host.registry.mount(command);
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      host.registry.set(command, { retry });
      yield* Effect.promise(() =>
        waitFor(() => expect(host.registry.get(command).waiting).toBe(false)),
      );
      const run = host.registry.get(command);
      expect(AsyncResult.isSuccess(run) && run.value).toEqual({
        retry,
        result: converted,
      });
      expect(notifier.notices.map((notice) => notice.messages)).toEqual([
        [m.notice_literature_note_template_conversion_success()],
      ]);
    }),
);
