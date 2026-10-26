// @vitest-environment happy-dom
// The skipped-sources notice: one notice for each pooled skip summary.
import { it } from "@effect/vitest";
import { ButtonComponent, controlsOf } from "@mock/obsidian";
import { Effect, Exit, Layer, PubSub, Queue, Scope, Stream } from "effect";
import { expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import type { RecordedNotice } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";

import { layerAttachmentSkipNotice } from "./notices";
import { AttachmentImport } from "./service";
import type { AttachmentSkipSummary } from "./service";

const SUMMARY: AttachmentSkipSummary = {
  blocked: 2,
  refused: 1,
  blockedFolders: ["/outside"],
};

/**
 * The notice layer over a skip stream the case publishes to, built in
 * `scope`. `shown` takes one element for each notice shown.
 */
const register = Effect.fn("test.register")(function* (scope: Scope.Scope) {
  const skipped = yield* PubSub.unbounded<AttachmentSkipSummary>();
  const shown = yield* Queue.unbounded<void>();
  const notifier = testNotifier();
  const openSettings = vi.fn();
  yield* Layer.buildWithScope(
    layerAttachmentSkipNotice({ openSettings }).pipe(
      Layer.provide(
        Layer.mock(AttachmentImport, { skipped: Stream.fromPubSub(skipped) }),
      ),
      Layer.provide(
        Layer.succeed(
          Notifier,
          Notifier.of({
            ...notifier.service,
            show: (message, options) =>
              notifier.service
                .show(message, options)
                .pipe(Effect.tap(Queue.offer(shown, undefined))),
          }),
        ),
      ),
    ),
    scope,
  );
  return { skipped, shown, notices: notifier.notices, openSettings };
});

/** The notice's message, and its one action button. */
function partsOf(notice: RecordedNotice | undefined) {
  const message = notice?.messages[0];
  if (message === undefined || typeof message === "string")
    throw new Error("Expected a rendered notice");
  const [button] = controlsOf(
    message.querySelector<HTMLElement>(".zt-notice-actions")!,
  ).filter(
    (control): control is ButtonComponent => control instanceof ButtonComponent,
  );
  return { text: message.textContent, button: button! };
}

it.effect("shows one notice for each skip summary, naming the folders", () =>
  Effect.gen(function* () {
    const { skipped, shown, notices } = yield* register(yield* Effect.scope);

    yield* PubSub.publish(skipped, SUMMARY);
    yield* Queue.take(shown);

    expect(notices).toHaveLength(1);
    expect(notices[0]?.duration).toBe(30_000);
    const { text } = partsOf(notices[0]);
    expect(text).toContain(m.notice_attachment_sources_skipped({ count: 3 }));
    expect(text).toContain("/outside");
  }),
);

it.effect("opens the settings and hides the notice from its action", () =>
  Effect.gen(function* () {
    const { skipped, shown, notices, openSettings } = yield* register(
      yield* Effect.scope,
    );
    yield* PubSub.publish(skipped, SUMMARY);
    yield* Queue.take(shown);

    partsOf(notices[0]).button.click();

    expect(openSettings).toHaveBeenCalledOnce();
    expect(notices[0]?.hidden).toBe(true);
  }),
);

it.effect("shows nothing for a summary published after the Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { skipped, notices } = yield* register(scope);

    // Closing the Scope ends the subscription, so the summary reaches no one.
    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(skipped, SUMMARY);

    expect(notices).toEqual([]);
  }),
);
