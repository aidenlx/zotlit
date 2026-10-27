import { it } from "@effect/vitest";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";
import * as lookupEvents from "@/services/citation-index/lookup-service";
import { layerLibraryScope } from "@/services/library-scope/service";
import { layerQueryClients } from "@/services/query-client/service";
import { layerPluginSettings } from "@/services/settings/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { layerZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";

import { lookupFixture } from "./__fixtures__";
import { CitationLookup, layerCitationLookup } from "./lookup-service";

it.effect(
  "builds without waiting for the initial Citation Lookup read (#1705)",
  () =>
    Effect.gen(function* () {
      const client = Effect.flatMap(
        inProcessClient(
          layerRcRef(
            memoryOpener(() =>
              seedWorksSql([
                { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
              ]),
            ).open,
          ),
        ),
        (client) =>
          client.Libraries({}).pipe(
            Effect.orDie,
            Effect.as({
              ...client,
              CitationLookup: (() =>
                Effect.never) as typeof client.CitationLookup,
            }),
          ),
      );
      const context = yield* Layer.build(
        layerCitationLookup.pipe(
          Layer.provide(
            layerLibraryScope.pipe(
              Layer.provideMerge(layerQueryClients),
              Layer.provideMerge(layerZoteroReads(client)),
              Layer.provide(
                layerPluginSettings({
                  loadData: async () => ({ __VERSION__: 10 }),
                  saveData: async () => {},
                }),
              ),
            ),
          ),
        ),
      );
      const service = Context.get(context, CitationLookup);
      expect(yield* service.current).toMatchObject({
        status: "pending",
        stopped: false,
      });
      expect(yield* Stream.runHead(service.changes)).toMatchObject({
        value: { status: "pending", stopped: false },
      });
    }),
);

it.effect(
  "late subscribers see stopped state and held reads close with the runtime (#1705)",
  () =>
    Effect.gen(function* () {
      const f = yield* lookupFixture(
        inProcessClient(
          layerRcRef(
            memoryOpener(() =>
              seedWorksSql([
                { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
              ]),
            ).open,
          ),
        ),
      );
      yield* Effect.promise(() =>
        f.service.bridge.runPromise(f.service.whenResolved),
      );
      const view = f.service.bridge.runSync(f.service.observe(() => {}));
      view.set({ citekeys: ["first"] });
      yield* Effect.promise(async () => {
        await expect.poll(() => view.current?.status).toBe("fresh");
      });
      const status = f.service.bridge.runSync(f.service.current).status;
      yield* Effect.promise(() => f.close());
      expect(view.current).toBeNull();
      view.set({ citekeys: ["second"] });
      expect(view.current).toBeNull();
      const late = yield* Stream.runCollect(f.service.changes);
      expect(late).toEqual([
        { status, revision: expect.any(String), stopped: true },
      ]);
      expect(f.service.bridge.runSync(f.service.current).status).toBe(status);
      yield* Effect.promise(() =>
        expect(
          f.service.bridge.runPromise(f.service.read({})),
        ).rejects.toMatchObject({ name: "AbortError" }),
      );
      const resolved = yield* Effect.promise(() =>
        f.service.bridge.runPromiseExit(f.service.whenResolved),
      );
      expect(
        Exit.isFailure(resolved) && Cause.hasInterruptsOnly(resolved.cause),
      ).toBe(true);
      const inert = f.service.bridge.runSync(
        f.service.observe(() => {
          throw new Error("released observer");
        }),
      );
      inert.set({ citekeys: ["first"] });
      expect(inert.current).toBeNull();
      subscribe(f.runtime, f.service.changes, () => {
        throw new Error("released subscriber");
      })();
      subscribe(f.runtime, lookupEvents.lookupChanged(f.service), () => {
        throw new Error("released event");
      })();
      inert[Symbol.dispose]();
      view[Symbol.dispose]();
    }),
);

it.effect(
  "publishes a first answer after startup on the test Clock (#1705)",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const f = yield* lookupFixture(
        Effect.map(
          inProcessClient(
            layerRcRef(
              memoryOpener(() =>
                seedWorksSql([
                  { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
                ]),
              ).open,
            ),
          ),
          (client) => ({
            ...client,
            CitationLookup: ((
              ...args: Parameters<typeof client.CitationLookup>
            ) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Effect.sleep("1 second");
                return yield* client.CitationLookup(...args);
              })) as typeof client.CitationLookup,
          }),
        ),
      );
      yield* Deferred.await(started);
      expect(yield* f.service.current).toMatchObject({
        status: "pending",
        revision: null,
      });
      yield* TestClock.adjust("1 second");
      yield* f.service.whenResolved;
      expect(yield* Stream.runHead(f.service.changes)).toMatchObject({
        value: { status: "fresh", revision: expect.any(String) },
      });
    }),
);

it.effect(
  "runtime disposal cancels active reads and settles pending adapter calls (#1705)",
  () =>
    Effect.gen(function* () {
      const initial = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const f = yield* lookupFixture(
        Effect.map(
          inProcessClient(
            layerRcRef(
              memoryOpener(() =>
                seedWorksSql([
                  { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
                ]),
              ).open,
            ),
          ),
          (client) => ({
            ...client,
            CitationLookup: ((
              ...args: Parameters<typeof client.CitationLookup>
            ) =>
              Deferred.succeed(
                args[0].citekeys?.length ? started : initial,
                undefined,
              ).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Deferred.succeed(interrupted, undefined),
                ),
              )) as typeof client.CitationLookup,
          }),
        ),
      );
      yield* Deferred.await(initial);
      const reading = f.service.bridge.runPromise(
        f.service.read({ citekeys: ["first"] }),
      );
      const rejected = expect(reading).rejects.toMatchObject({
        name: "AbortError",
      });
      yield* Deferred.await(started);
      const waiting = f.service.bridge.runPromiseExit(f.service.whenResolved);
      const events = yield* Stream.runDrain(f.service.invalidated).pipe(
        Effect.forkChild,
      );
      yield* Effect.promise(() => f.close());
      yield* Deferred.await(interrupted);
      yield* Effect.promise(() => rejected);
      const settled = yield* Effect.promise(() => waiting);
      expect(
        Exit.isFailure(settled) && Cause.hasInterruptsOnly(settled.cause),
      ).toBe(true);
      yield* Fiber.join(events);
    }),
);
