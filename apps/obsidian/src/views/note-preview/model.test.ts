import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { makePreviewHost } from "./__fixtures__/model";
import { patchPreview } from "./model";

describe("preview model lifetime and dependencies", () => {
  it.effect("interrupts a snapshot read when its owner closes", () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() => makePreviewHost()),
      );
      const preview = host.open("MAIN2345");
      yield* Effect.promise(() =>
        waitFor(() => expect(host.started).toEqual(["MAIN2345"])),
      );
      preview[Symbol.dispose]();
      yield* Effect.promise(() =>
        waitFor(() => expect(host.cancelled).toEqual(["MAIN2345"])),
      );
    }),
  );

  it.effect(
    "reloads connected data on Zotero changes and keeps presentation changes local",
    () =>
      Effect.gen(function* () {
        const host = yield* Effect.acquireDisposable(
          Effect.promise(() => makePreviewHost()),
        );
        const preview = yield* Effect.acquireDisposable(
          Effect.sync(() => host.open("MAIN2345")),
        );
        yield* Effect.promise(() =>
          waitFor(() => expect(host.started).toEqual(["MAIN2345"])),
        );
        host.registry.update(
          preview.model.input,
          patchPreview({
            showMarkdown: true,
            annotationId: "example:underline",
          }),
        );
        expect(host.started).toEqual(["MAIN2345"]);
        host.changeZotero();
        yield* Effect.promise(() =>
          waitFor(() => expect(host.started).toEqual(["MAIN2345", "MAIN2345"])),
        );
        expect(preview.state()).toMatchObject({
          status: "loading",
          showMarkdown: true,
        });
        expect(host.cancelled).toEqual(["MAIN2345"]);
      }),
  );

  it.effect("keeps sample data independent of Zotero changes", () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() => makePreviewHost()),
      );
      const preview = yield* Effect.acquireDisposable(
        Effect.sync(() => host.open("sample:book")),
      );
      yield* Effect.promise(() => preview.ready());
      const before = preview.state().snapshot;
      host.changeZotero();
      expect(host.subscribers()).toBe(0);
      expect(host.started).toEqual([]);
      expect(preview.state().snapshot).toBe(before);
    }),
  );
});
