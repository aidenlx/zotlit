import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { expect, it, vi } from "vitest";

import * as db from "@zotlit/db";

import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { CitekeySnapshot } from "@/services/citation-index/snapshot";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { makeCitationLookup } from "./citation-lookup";
import { Connection, layerRcRef } from "./connection";
import { makeInProcessClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import {
  citationSource,
  inProcessClient,
  memoryOpener,
  seedWorksSql,
  worksSql,
} from "./test-utils";
import { makeWorkerReads } from "./worker-host";

const seed =
  () => `${seedWorksSql([{ itemID: 1, key: "PERSONAL", citationKey: "shared" }])}
insert into libraries (libraryID, type) values (2, 'group');
insert into groups (groupID, libraryID, name) values (7, 2, 'Group');
${worksSql([{ itemID: 2, libraryID: 2, key: "GROUPKEY", citationKey: "shared" }])}
`;

const requestFor = (generation: number, databasePath = "fixture") => ({
  ...citationSource(generation, { databasePath }),
  scope: MY_LIBRARY_SCOPE,
  citekeys: ["first", "second", "third", "fourth"],
  indexedKeys: ["ITEMKEY1"],
});

it("refreshes an unseen generation from its request config and ignores older configs", async () => {
  const configurations: string[] = [];
  const opener = memoryOpener(() =>
    seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: "first" }]),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        const { lookup } = yield* makeCitationLookup(
          connection,
          1,
          (config) => {
            configurations.push(config.databasePath);
            return connection.configure(config);
          },
        );
        const first = yield* lookup(requestFor(42, "new-source"));
        expect(first.generation).toBe(42);
        expect(first.indexedKeys.get("ITEMKEY1")).toBe("first");
        expect(yield* lookup(requestFor(42, "new-source"))).toEqual(first);
        expect(yield* lookup(requestFor(3, "obsolete-source"))).toEqual(first);
        expect(configurations).toEqual(["new-source"]);
      }).pipe(Effect.provide(layerRcRef(opener.open))),
    ),
  );
});

it("coalesces a burst and a trailing generation while cancellation ends only one wait", async () => {
  let key = "first";
  const opener = memoryOpener(() =>
    seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: key }]),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const configured: string[] = [];
        let hold = false;
        let refreshes = 0;
        let active = 0;
        let maximum = 0;
        const { lookup } = yield* makeCitationLookup(
          {
            ...connection,
            refresh: Effect.gen(function* () {
              refreshes += 1;
              active += 1;
              maximum = Math.max(maximum, active);
              if (hold) {
                hold = false;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              yield* connection.refresh;
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active -= 1;
                }),
              ),
            ),
          },
          1,
          (config) => {
            configured.push(config.databasePath);
            key = config.databasePath;
            return connection.configure(config);
          },
        );
        const first = yield* lookup(requestFor(0, "first"));
        hold = true;
        const cancelled = yield* Effect.forkChild(
          lookup(requestFor(1, "second")),
        );
        yield* Deferred.await(entered);
        const same = yield* Effect.forkChild(lookup(requestFor(1, "second")));
        const third = yield* Effect.forkChild(lookup(requestFor(2, "third")));
        const fourth = yield* Effect.forkChild(lookup(requestFor(3, "fourth")));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(cancelled);
        expect(Exit.hasInterrupts(yield* Fiber.await(cancelled))).toBe(true);
        expect(active).toBe(1);
        yield* Deferred.succeed(release, undefined);
        const answers = yield* Effect.all([
          Fiber.join(same),
          Fiber.join(third),
          Fiber.join(fourth),
        ]);
        expect(answers.map((answer) => answer.generation)).toEqual([3, 3, 3]);
        expect(
          answers.map((answer) => answer.indexedKeys.get("ITEMKEY1")),
        ).toEqual(["fourth", "fourth", "fourth"]);
        expect(configured).toEqual(["first", "second", "fourth"]);
        expect(refreshes).toBe(3);
        expect(maximum).toBe(1);
        expect(first.indexedKeys.get("ITEMKEY1")).toBe("first");
      }).pipe(Effect.provide(layerRcRef(opener.open))),
    ),
  );
});

it("keeps a failed generation unavailable until a newer refresh succeeds", async () => {
  let fail = false;
  const opener = memoryOpener(() =>
    fail
      ? null
      : seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: "first" }]),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(layerRcRef(opener.open), {
          citationOnly: true,
        });
        const first = yield* client.CitationLookup(requestFor(0));
        fail = true;
        const failed = yield* Effect.flip(client.CitationLookup(requestFor(1)));
        expect(failed).toMatchObject({ _tag: "DbUnavailable" });
        fail = false;
        expect(
          yield* Effect.flip(client.CitationLookup(requestFor(1))),
        ).toEqual(failed);
        expect(
          yield* Effect.flip(client.CitationLookup(requestFor(0))),
        ).toEqual(failed);
        const recovered = yield* client.CitationLookup(requestFor(2));
        expect(recovered.generation).toBe(2);
        expect(recovered.revision).toBe(first.revision);
        expect(first.indexedKeys.get("ITEMKEY1")).toBe("first");
      }),
    ),
  );
});

it("a newer generation succeeds after an obsolete in-flight refresh fails", async () => {
  const opener = memoryOpener(() =>
    seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: "first" }]),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let first = true;
        const { lookup } = yield* makeCitationLookup(
          {
            ...connection,
            refresh: Effect.gen(function* () {
              if (first) {
                first = false;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return yield* new DbUnavailable({
                  message: "obsolete source failed",
                });
              }
              yield* connection.refresh;
            }),
          },
          1,
        );
        const old = yield* Effect.forkChild(lookup(requestFor(1)));
        yield* Deferred.await(entered);
        const current = yield* Effect.forkChild(lookup(requestFor(2)));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(old)).generation).toBe(2);
        expect((yield* Fiber.join(current)).generation).toBe(2);
      }).pipe(Effect.provide(layerRcRef(opener.open))),
    ),
  );
});

it("unload interrupts an active refresh and all its waiters and releases connections", async () => {
  const opener = memoryOpener(seed);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const lifetime = yield* Scope.fork(yield* Scope.Scope);
        const entered = yield* Deferred.make<void>();
        const ended = yield* Deferred.make<void>();
        const context = yield* Layer.buildWithScope(
          layerRcRef(opener.open),
          lifetime,
        );
        const { lookup } = yield* Scope.provide(
          Effect.gen(function* () {
            const connection = yield* Connection;
            return yield* makeCitationLookup(
              {
                ...connection,
                refresh: Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(ended, undefined)),
                ),
              },
              1,
            );
          }).pipe(Effect.provideContext(context)),
          lifetime,
        );
        const first = yield* Effect.forkChild(lookup(requestFor(1)));
        yield* Deferred.await(entered);
        const second = yield* Effect.forkChild(lookup(requestFor(2)));
        yield* Effect.yieldNow;
        yield* Scope.close(lifetime, Exit.void);
        yield* Deferred.await(ended);
        expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true);
        expect(Exit.hasInterrupts(yield* Fiber.await(second))).toBe(true);
        expect(opener.log).toEqual(["open #1", "close #1"]);
      }),
    ),
  );
});

it("discards an obsolete build when the new source reuses local Library IDs", async () => {
  let groupID = 7;
  const opener = memoryOpener(() =>
    seed().replace("(7, 2, 'Group')", `(${groupID}, 2, 'Group')`),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        const { lookup } = yield* makeCitationLookup(
          connection,
          1,
          (config) => {
            groupID = config.databasePath === "new" ? 9 : 7;
            return connection.configure(config);
          },
        );
        const request = {
          ...citationSource(0, { databasePath: "old" }),
          scope: {
            mode: "selected" as const,
            libraries: [{ type: "group" as const, groupID: 7 }],
          },
          citekeys: ["shared"],
          indexedKeys: ["GROUPKEYg7", "GROUPKEYg9"],
        };
        const first = yield* lookup(request);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const from = CitekeySnapshot.from;
        let hold = true;
        using build = vi
          .spyOn(CitekeySnapshot, "from")
          .mockImplementation((...args) =>
            from(...args).pipe(
              Effect.tap(() => {
                if (!hold) return Effect.void;
                hold = false;
                return Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                );
              }),
            ),
          );
        const old = yield* Effect.forkChild(
          lookup({ ...request, generation: 1 }),
        );
        yield* Deferred.await(entered);
        const current = yield* Effect.forkChild(
          lookup({ ...request, ...citationSource(2, { databasePath: "new" }) }),
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const answer = yield* Fiber.join(current);
        expect(answer.generation).toBe(2);
        expect(answer.revision).not.toBe(first.revision);
        expect(answer.citekeys.get("shared")).toEqual({ kind: "missing" });
        expect(answer.indexedKeys.get("GROUPKEYg7")).toBeNull();
        expect(answer.indexedKeys.get("GROUPKEYg9")).toBe("shared");
        expect(yield* Fiber.join(old)).toEqual(answer);
        expect(build).toHaveBeenCalledTimes(2);
        expect(first.citekeys.get("shared")).toMatchObject({
          kind: "unique",
          item: { indexedKey: "GROUPKEYg7" },
        });
      }).pipe(Effect.provide(layerRcRef(opener.open))),
    ),
  );
});

it("recovers a worker lost mid-refresh on the next refresh and learns the generation on demand", async () => {
  const opener = memoryOpener(() =>
    seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: "first" }]),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const died = yield* Deferred.make<DbUnavailable>();
        let spawned = 0;
        let hold = false;
        const connect = Effect.gen(function* () {
          const worker = ++spawned;
          const context = yield* Layer.build(layerRcRef(opener.open));
          const connection = yield* Effect.provideContext(Connection, context);
          const client = yield* makeInProcessClient({
            citationOnly: true,
          }).pipe(
            Effect.provideService(Connection, {
              ...connection,
              refresh: Effect.suspend(() =>
                worker === 1 && hold
                  ? Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(interrupted, undefined),
                      ),
                    )
                  : connection.refresh,
              ),
            }),
          );
          return {
            client,
            died: worker === 1 ? Deferred.await(died) : Effect.never,
            abandon: Effect.void,
          };
        });
        const reads = yield* makeWorkerReads(connect);
        const first = yield* reads.CitationLookup(requestFor(10));
        hold = true;
        const old = yield* Effect.forkChild(
          reads.CitationLookup(requestFor(11)),
        );
        yield* Deferred.await(entered);
        const degraded = yield* Effect.forkChild(
          reads.Changes().pipe(
            Stream.filter((event) => event._tag === "degraded"),
            Stream.take(1),
            Stream.runDrain,
          ),
        );
        yield* Deferred.succeed(
          died,
          new DbUnavailable({ message: "worker lost during refresh" }),
        );
        yield* Fiber.join(degraded);
        yield* Deferred.await(interrupted);
        expect(Exit.isFailure(yield* Fiber.await(old))).toBe(true);
        // A read finds no worker; only a refresh connects a replacement.
        const unavailable = yield* Effect.exit(
          reads.CitationLookup(requestFor(11)),
        );
        expect(Exit.isFailure(unavailable)).toBe(true);
        expect(spawned).toBe(1);
        // A plain Refresh carries no generation: the replacement learns
        // generation 11 from the lookup itself.
        yield* reads.Refresh();
        const recovered = yield* reads.CitationLookup(requestFor(11));
        expect(spawned).toBe(2);
        expect(recovered.generation).toBe(11);
        expect(recovered.revision).not.toBe(first.revision);
        expect(recovered.indexedKeys.get("ITEMKEY1")).toBe("first");
      }),
    ),
  );
  expect(opener.log.filter((entry) => entry.startsWith("close")).length).toBe(
    opener.log.filter((entry) => entry.startsWith("open")).length,
  );
});

it("answers one requested batch with scope-limited forward and all-library reverse lookups", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(seed).open),
          { citationOnly: true, sliceSize: 1 },
        );
        const wire = yield* client.CitationLookup({
          ...citationSource(),
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["shared", "missing"],
          indexedKeys: ["GROUPKEYg7", "absent"],
        });
        const answer = new CitationLookupAnswer(wire);
        expect(answer.resolve("shared")).toMatchObject({
          kind: "unique",
          item: { indexedKey: "PERSONAL" },
        });
        expect(answer.resolve("missing")).toEqual({ kind: "missing" });
        expect(() => answer.resolve("unrequested")).toThrow("unrequested");
        expect(answer.citekeyOf("GROUPKEYg7")).toBe("shared");
        expect(answer.citekeyOf("absent")).toBeNull();
        expect(() => answer.citekeyOf("unrequested")).toThrow("unrequested");
        expect(wire.citekeys.size).toBe(2);
        expect(wire.indexedKeys.size).toBe(2);
        const all = yield* client.CitationLookup({
          ...citationSource(),
          scope: { mode: "all" },
          citekeys: ["shared"],
          indexedKeys: [],
        });
        expect(all.citekeys.get("shared")).toMatchObject({
          kind: "ambiguous",
          candidates: [
            { indexedKey: "PERSONAL" },
            { indexedKey: "GROUPKEYg7" },
          ],
        });
      }),
    ),
  );
});

it("keeps a revision on an equal refresh and replaces it when citation answers change", async () => {
  let key = "shared";
  const opener = memoryOpener(() => seed().replaceAll("'shared'", `'${key}'`));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(layerRcRef(opener.open), {
          citationOnly: true,
        });
        const request = {
          ...citationSource(),
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["shared", "renamed"],
          indexedKeys: ["PERSONAL"],
        };
        const first = yield* client.CitationLookup(request);
        const equal = yield* client.CitationLookup({
          ...request,
          generation: 1,
        });
        expect(equal.revision).toBe(first.revision);
        key = "renamed";
        const changed = yield* client.CitationLookup({
          ...request,
          generation: 2,
        });
        expect(changed.revision).not.toBe(first.revision);
        expect(changed.citekeys.get("shared")).toEqual({ kind: "missing" });
        expect(changed.indexedKeys.get("PERSONAL")).toBe("renamed");
        expect(first.indexedKeys.get("PERSONAL")).toBe("shared");
      }),
    ),
  );
});

it("continues a shared worker build after one caller cancels", async () => {
  const works = Array.from({ length: 1000 }, (_, index) => ({
    itemID: index + 1,
    key: `K${String(index).padStart(7, "0")}`,
    citationKey: `key${index}`,
  }));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(() => seedWorksSql(works)).open),
          { citationOnly: true, sliceSize: 1 },
        );
        const request = {
          ...citationSource(),
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["key999"],
          indexedKeys: ["K0000999"],
        };
        const cancelled = yield* Effect.forkChild(
          client.CitationLookup(request),
        );
        yield* Effect.yieldNow;
        const remaining = yield* Effect.forkChild(
          client.CitationLookup(request),
        );
        yield* Fiber.interrupt(cancelled);
        const answer = yield* Fiber.join(remaining);
        expect(answer.citekeys.get("key999")).toMatchObject({
          kind: "unique",
          item: { indexedKey: "K0000999" },
        });
        expect(answer.indexedKeys.get("K0000999")).toBe("key999");
        expect((yield* client.CitationLookup(request)).revision).toBe(
          answer.revision,
        );
      }),
    ),
  );
});

it.each(["construction", "comparison"] as const)(
  "interrupting %s keeps the published answer and releases the candidate",
  async (phase) => {
    const works = Array.from({ length: 512 }, (_, index) => ({
      itemID: index + 1,
      key: `K${String(index).padStart(7, "0")}`,
      citationKey: `key${index}`,
    }));
    const opener = memoryOpener(() => seedWorksSql(works));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* Connection;
          let borrows = 0;
          const { lookup } = yield* makeCitationLookup(
            {
              ...connection,
              borrow: Effect.acquireRelease(
                Effect.tap(connection.borrow, () =>
                  Effect.sync(() => {
                    borrows += 1;
                  }),
                ),
                () =>
                  Effect.sync(() => {
                    borrows -= 1;
                  }),
              ),
            },
            works.length,
          );
          const request = {
            ...citationSource(),
            scope: MY_LIBRARY_SCOPE,
            citekeys: ["key0", "key511"],
            indexedKeys: ["K0000000", "K0000511"],
          };
          const first = yield* lookup(request);
          const reached = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const markWork = () => {
            const fiber = Fiber.getCurrent();
            if (fiber) Deferred.doneUnsafe(reached, Effect.succeed(fiber));
          };
          // Make each budget check expire, independent of machine speed.
          let now = 0;
          using clock = vi.spyOn(performance, "now").mockImplementation(() => {
            now += 5;
            return now;
          });
          const getPage = db.getCitekeyPage;
          using pages = vi
            .spyOn(db, "getCitekeyPage")
            .mockImplementation((...args) => {
              const page = getPage(...args);
              if (phase === "construction") {
                page.citekeys = page.citekeys.map((row) => ({
                  ...row,
                  get indexedKey() {
                    markWork();
                    return row.indexedKey;
                  },
                }));
              }
              return page;
            });
          const resolution = first.citekeys.get("key0");
          expect(resolution?.kind).toBe("unique");
          if (resolution?.kind !== "unique")
            throw new Error("Expected an Item");
          const indexedKey = resolution.item.indexedKey;
          if (phase === "comparison") {
            Object.defineProperty(resolution.item, "indexedKey", {
              configurable: true,
              get() {
                markWork();
                return indexedKey;
              },
            });
          }

          const rebuild = { ...request, scope: { mode: "all" as const } };
          const waiting = yield* Effect.forkChild(lookup(rebuild));
          const candidate = yield* Deferred.await(reached);
          expect(candidate.pollUnsafe()).toBeUndefined();
          expect(borrows).toBe(1);
          yield* Fiber.interrupt(candidate);
          expect(Exit.hasInterrupts(yield* Fiber.await(waiting))).toBe(true);
          expect(borrows).toBe(0);
          pages.mockRestore();
          clock.mockRestore();
          Object.defineProperty(resolution.item, "indexedKey", {
            configurable: true,
            writable: true,
            value: indexedKey,
          });

          expect(yield* lookup(request)).toEqual(first);
          expect(yield* lookup(rebuild)).toEqual(first);
          expect(borrows).toBe(0);
        }).pipe(Effect.provide(layerRcRef(opener.open))),
      ),
    );
    expect(opener.log).toEqual(["open #1", "open #2", "close #1", "close #2"]);
  },
);

it("gives identical databases distinct revisions after a worker restart", async () => {
  const read = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* inProcessClient(
            layerRcRef(memoryOpener(seed).open),
            { citationOnly: true },
          );
          return yield* client.CitationLookup({
            ...citationSource(),
            scope: MY_LIBRARY_SCOPE,
            citekeys: [],
            indexedKeys: [],
          });
        }),
      ),
    );
  expect((await read()).revision).not.toBe((await read()).revision);
});
