import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { WriteRunFailed } from "@/services/annotation-repository/service";
import type { AnnotationRepository } from "@/services/annotation-repository/service";

import { READER_NOW, toolColors } from "./__fixtures__";
import { bindingResources, stepMarkHistory } from "./operations";
import { makeReaderSurfaceModel } from "./reader-surface-model";
import type {
  ReaderSurfaceModel,
  ReaderSurfaceRegistry,
} from "./reader-surface-model";
import { initialReaderSurfaceState, toggleMarks } from "./reader-surface-state";

it.effect(
  "says a History Step that failed before Zotero answered has an unknown outcome",
  () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const annotations = stubService<
        Pick<AnnotationRepository["Service"], "undo" | "redo">
      >("AnnotationRepository", {
        undo: () =>
          Effect.fail(new WriteRunFailed({ cause: new Error("Reply lost") })),
      });

      const outcome = yield* stepMarkHistory(annotations, notifier.service, {
        attachmentKey: "RGRPDF24",
        direction: "undo",
        now: () => READER_NOW,
      });

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      });
      expect(notifier.notices.map(({ messages }) => messages)).toEqual([
        [
          m.annot_view_write_failed({
            reason: m.annot_view_write_reason_unknown_outcome(),
          }),
        ],
      ]);
    }),
);

it.effect(
  "ends a view's writes before it disposes the registry they write to",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { registry, writes } = yield* bindingResources.pipe(
        Scope.provide(scope),
      );
      const model = makeReaderSurfaceModel(
        initialReaderSurfaceState({
          colors: toolColors().current(),
          capability: { kind: "writable" },
          now: READER_NOW,
        }),
      );
      // A create Zotero answers only once the view has begun to close; its
      // settle writes the state, as a Text Draft's or an ink create's does.
      const started = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      /** Mark visibility as the settle left it, read in the same write. */
      let settled: boolean | undefined;
      const create = writes(
        Effect.uninterruptible(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(answer)),
            Effect.andThen(
              Effect.sync(() => {
                registry.update(model.state, toggleMarks);
                settled = registry.get(model.state).marksVisible;
              }),
            ),
          ),
        ),
      );
      yield* Deferred.await(started);
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      // The close begins, and waits on the create before Zotero answers it.
      yield* Effect.yieldNow;
      yield* Deferred.succeed(answer, undefined);
      yield* Fiber.join(closing);
      yield* Fiber.await(create);

      // The settle landed on a live registry, and the close disposed it after.
      expect(settled).toBe(false);
      expect(isOpen(registry, model)).toBe(false);
    }),
);

/** Whether the registry still answers for the model, rather than being disposed. */
function isOpen(
  registry: ReaderSurfaceRegistry,
  model: ReaderSurfaceModel,
): boolean {
  try {
    registry.get(model.state);
    return true;
  } catch {
    return false;
  }
}
