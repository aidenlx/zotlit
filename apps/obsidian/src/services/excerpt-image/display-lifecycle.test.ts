import { it } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { expect } from "vitest";

import { layerQueryClients } from "@/services/query-client/service";

import type { ExcerptRequest } from "./contract";
import { ExcerptDisplays, layerExcerptDisplays } from "./display";
import { ExcerptImageService } from "./service";

const request: ExcerptRequest = {
  annotation: {
    key: "INK1",
    parentKey: "PDF1",
    type: "ink",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
  },
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "local", serverID: "server" },
    libraryID: 1,
    libraryRevision: 1,
  },
  sourceScope: "/fixture",
  attachmentKey: "PDF1",
  libraryID: 1,
  pdfPath: "/paper.pdf",
  zoteroPngPath: null,
};

// #1795: the public display boundary owns pending resolutions and stored reads.
it.effect.each(["visible", "stored"] as const)(
  "interrupts the pending %s read when the display layer closes",
  (kind) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let interrupted = false;
      const pending = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      );
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const context = yield* Layer.buildWithScope(
        layerExcerptDisplays.pipe(
          Layer.provide(layerQueryClients),
          Layer.provide(
            Layer.mock(ExcerptImageService, {
              rendererDiagnostics: undefined,
              queueDiagnostics: {
                admitted: 0,
                rendering: 0,
                queued: 0,
                checking: 0,
                awaiting: 0,
              },
              resolve: () => pending,
              stored: () =>
                kind === "stored" ? pending : Effect.succeed(null),
            }),
          ),
        ),
        scope,
      );
      const displays = Context.get(context, ExcerptDisplays);
      const card = yield* displays.open;
      if (kind === "visible") card.demand(request);
      else yield* displays.revalidate(request);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);
      expect(interrupted).toBe(true);
      expect(card.snapshot().image).toBeNull();
    }),
);
