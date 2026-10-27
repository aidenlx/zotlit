import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import type { ZoteroReadLease } from "@/services/zotero-reads/service";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";
import { getSampleItem } from "@/views/template-workbench/selection-data";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { makeNativeRenderer } from "./render";

describe("preview render commands", () => {
  it.effect("interrupts the render's reads when its owner closes", () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireDisposable(
        Effect.promise(() => createRenderFixture()),
      );
      const pending = Promise.withResolvers<ZoteroReadLease>();
      const acquire = vi
        .spyOn(fixture.deps.zoteroReads, "acquireRead")
        .mockImplementation(() => pending.promise);
      const renderer = makeNativeRenderer(fixture.deps);
      const result = renderer
        .render({ source: PROFILE_SOURCE, snapshot: fixture.snapshot })
        .then(
          () => null,
          (error: unknown) => error,
        );
      yield* Effect.promise(() =>
        waitFor(() => expect(acquire).toHaveBeenCalledTimes(2)),
      );
      renderer[Symbol.dispose]();
      expect(yield* Effect.promise(() => result)).toBeInstanceOf(Error);
      yield* Effect.promise(() =>
        waitFor(() => expect(fixture.cancelled).toHaveLength(2)),
      );
    }),
  );

  it.effect("reuses one owner's command for successive draft renders", () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireDisposable(
        Effect.promise(() => createRenderFixture()),
      );
      const renderer = yield* Effect.acquireDisposable(
        Effect.sync(() => makeNativeRenderer(fixture.deps)),
      );
      const snapshot = getSampleItem("sample:book")!;
      const first = yield* Effect.promise(() =>
        renderer.render({ source: PROFILE_SOURCE, snapshot }),
      );
      expect(first.creationBody).toContain("Personal space.");
      const second = yield* Effect.promise(() =>
        renderer.render({
          source: PROFILE_SOURCE.replace("Personal space.", "Second draft."),
          snapshot,
        }),
      );
      expect(second.creationBody).toContain("Second draft.");
    }),
  );
});
