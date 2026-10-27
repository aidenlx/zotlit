import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { expect } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";
import {
  QueryClients,
  layerQueryClients,
} from "@/services/query-client/service";

import { settledDisplay } from "./__fixtures__/display-state";
import type { ExcerptRequest } from "./contract";
import { ExcerptDisplays, layerExcerptDisplays } from "./display";
import { PNG_FORMAT } from "./format";
import { ExcerptImageService } from "./service";
import type { AvailableExcerpt } from "./service";

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

// #1795: a failed fresh read must still paint a slower stored fallback.
it.live(
  "retains a stored fallback that arrives after the fresh read fails",
  () =>
    Effect.gen(function* () {
      const fallback = yield* Deferred.make<AvailableExcerpt | null>();
      const context = yield* Layer.build(
        layerExcerptDisplays.pipe(
          Layer.provideMerge(layerQueryClients),
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
              resolve: () => Effect.succeed({ kind: "unavailable" }),
              stored: () => Deferred.await(fallback),
            }),
          ),
        ),
      );
      const displays = Context.get(context, ExcerptDisplays);
      const queries = Context.get(context, QueryClients);
      const settled = yield* Effect.forkChild(Stream.runHead(queries.changes), {
        startImmediately: true,
      });
      const card = yield* displays.open;
      card.demand(request);
      yield* Fiber.join(settled);
      // The host task lets the completed query's Promise settlement reach its owner.
      yield* Effect.promise(() => yieldToMain());
      yield* Deferred.succeed(fallback, {
        kind: "available",
        provenance: "cache",
        freshness: "unchecked",
        identity: {
          key: "previous-pixels",
          fingerprint: "previous-pixels",
          pdf: null,
        },
        bytes: new Uint8Array([7]),
        format: PNG_FORMAT,
      });
      const display = yield* Effect.promise(() =>
        settledDisplay(card, (value) => value.image !== null),
      );
      expect(display.image?.bytes).toEqual(new Uint8Array([7]));
      expect(display.current).toBe(false);
    }),
);
