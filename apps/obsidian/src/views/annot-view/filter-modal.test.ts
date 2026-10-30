// @vitest-environment happy-dom
// Closing the filter dialog releases its pending database read and snapshot.
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { QueryService } from "@/services/item-query/service";
import { LibraryScope } from "@/services/library-scope/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";

import { makeAnnotHost } from "./__fixtures__/host";
import { SidebarFilterModal } from "./filter-modal";

it.effect(
  "closing the filter modal interrupts its read and releases the snapshot",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      let interrupted = false;
      let released = false;
      const host = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          makeAnnotHost({
            reads: {
              snapshot: Effect.acquireRelease(
                Effect.succeed(
                  readsAnswering({
                    CollectionPaths: () =>
                      Effect.gen(function* () {
                        started.resolve();
                        return yield* Effect.never;
                      }).pipe(
                        Effect.ensuring(
                          Effect.sync(() => {
                            interrupted = true;
                          }),
                        ),
                      ),
                  }),
                ),
                () =>
                  Effect.sync(() => {
                    released = true;
                  }),
              ),
            },
            services: Layer.mergeAll(
              Layer.mock(LibraryScope, { current: Effect.succeed(null) }),
              Layer.mock(QueryService, {
                customFieldNames: Effect.succeed([]),
              }),
            ),
          }),
        ),
      );
      const app = stubService<App>("App", {});
      const query = new QueryView(
        stubService<QueryViewDeps>("QueryViewDeps", {
          app,
          registry: host.registry,
          literatureNotes: noLiteratureNotes(),
          opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
        }),
        {
          scope: new Scope(),
          sourcePath: () => "",
          context: () => undefined,
          save: () => {},
        },
      );
      const modal = new SidebarFilterModal(app, query);
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await act(() => modal.onClose());
        }),
      );
      yield* Effect.promise(() => act(() => modal.onOpen()));
      yield* Effect.promise(() => started.promise);
      yield* Effect.promise(() => act(() => modal.onClose()));
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(interrupted).toBe(true);
          expect(released).toBe(true);
        }),
      );
    }),
);
