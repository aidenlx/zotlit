// The Note Feature's change notices: one notice for each reported change.
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, PubSub, Queue, Scope, Stream } from "effect";
import { expect } from "vitest";

import { layerSignalling, testNotifier } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";

import { layerNoteFeatureNotices } from "./notices";
import { NoteFeature } from "./service";
import type { NoteFeatureEvent } from "./types";

/**
 * The notice layer over a change stream the case publishes to, built in
 * `scope`. `shown` takes one element for each notice shown.
 */
const register = Effect.fn("test.register")(function* (scope: Scope.Scope) {
  const changes = yield* PubSub.unbounded<NoteFeatureEvent>();
  const shown = yield* Queue.unbounded<void>();
  const notifier = testNotifier();
  yield* Layer.buildWithScope(
    layerNoteFeatureNotices.pipe(
      Layer.provide(
        Layer.mock(NoteFeature, { changes: Stream.fromPubSub(changes) }),
      ),
      Layer.provide(layerSignalling(notifier.service, shown)),
    ),
    scope,
  );
  return { changes, shown, notices: notifier.notices };
});

it.effect("shows the excerpt image summary", () =>
  Effect.gen(function* () {
    const { changes, shown, notices } = yield* register(yield* Effect.scope);
    const summary = { zotero: 2, unchecked: 1, unavailable: 0 };

    yield* PubSub.publish(changes, {
      _tag: "excerpt-images-reported",
      payload: summary,
    });
    yield* Queue.take(shown);

    expect(notices).toMatchObject([
      {
        messages: [m.excerpt_image_summary({ ...summary, notRefreshed: 0 })],
      },
    ]);
  }),
);

it.effect("names the fields a note write skipped", () =>
  Effect.gen(function* () {
    const { changes, shown, notices } = yield* register(yield* Effect.scope);

    yield* PubSub.publish(changes, {
      _tag: "frontmatter-eval-failed",
      payload: { itemKey: "ABCD2345", fields: ["title", "year"] },
    });
    yield* Queue.take(shown);

    expect(notices).toMatchObject([
      {
        messages: [m.notice_frontmatter_eval_failed({ fields: "title, year" })],
      },
    ]);
  }),
);

it.effect("shows nothing for a change published after the Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { changes, notices } = yield* register(scope);

    // Closing the Scope ends the subscriptions, so the change reaches no one.
    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(changes, {
      _tag: "frontmatter-eval-failed",
      payload: { itemKey: "ABCD2345", fields: ["title"] },
    });

    expect(notices).toEqual([]);
  }),
);
