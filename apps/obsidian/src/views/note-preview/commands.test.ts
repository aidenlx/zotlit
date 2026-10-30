import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { vi } from "vitest";

import { scopedViewRunner } from "@/lib/__fixtures__/view-runner";
import type { ZoteroReadLease } from "@/services/zotero-reads/service";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";
import { getSampleItem } from "@/views/template-workbench/selection-data";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { makeNativeRenderer } from "./render";

describe("preview render commands", () => {
  it.effect("interrupts the render's reads when its view closes", () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireDisposable(
        Effect.promise(() => createRenderFixture()),
      );
      const pending = Promise.withResolvers<ZoteroReadLease>();
      const acquire = vi
        .spyOn(fixture.deps.zoteroReads, "acquireRead")
        .mockImplementation(() => pending.promise);
      const runner = yield* scopedViewRunner(fixture.deps.registry);
      const render = runner.run(
        makeNativeRenderer(fixture.deps).render({
          source: PROFILE_SOURCE,
          snapshot: fixture.snapshot,
        }),
      );
      yield* Effect.promise(() =>
        waitFor(() => expect(acquire).toHaveBeenCalledTimes(2)),
      );
      yield* Effect.promise(() => runner[Symbol.asyncDispose]());
      expect(Exit.hasInterrupts(yield* Fiber.await(render))).toBe(true);
      yield* Effect.promise(() =>
        waitFor(() => expect(fixture.cancelled).toHaveLength(2)),
      );
    }),
  );

  it.effect("renders successive drafts on one view's runner", () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireDisposable(
        Effect.promise(() => createRenderFixture()),
      );
      const runner = yield* scopedViewRunner(fixture.deps.registry);
      const renderer = makeNativeRenderer(fixture.deps);
      const snapshot = getSampleItem("sample:book")!;
      const first = yield* Fiber.join(
        runner.run(renderer.render({ source: PROFILE_SOURCE, snapshot })),
      );
      expect(first.creationBody).toContain("Personal space.");
      const second = yield* Fiber.join(
        runner.run(
          renderer.render({
            source: PROFILE_SOURCE.replace("Personal space.", "Second draft."),
            snapshot,
          }),
        ),
      );
      expect(second.creationBody).toContain("Second draft.");
    }),
  );
});
