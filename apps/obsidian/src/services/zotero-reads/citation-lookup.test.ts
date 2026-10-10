import { Deferred, Effect, Exit, Fiber } from "effect";
import { expect, it, vi } from "vitest";

import * as db from "@zotlit/db";

import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { makeCitationLookup } from "./citation-lookup";
import { Connection, layerRcRef } from "./connection";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
  worksSql,
} from "./test-utils";

const seed =
  () => `${seedWorksSql([{ itemID: 1, key: "PERSONAL", citationKey: "shared" }])}
insert into libraries (libraryID, type) values (2, 'group');
insert into groups (groupID, libraryID, name) values (7, 2, 'Group');
${worksSql([{ itemID: 2, libraryID: 2, key: "GROUPKEY", citationKey: "shared" }])}
`;

it("answers one requested batch with scope-limited forward and all-library reverse lookups", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(seed).open),
          { citationWindowSize: 1 },
        );
        const wire = yield* client.CitationLookup({
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
      }),
    ),
  );
});

it("changes scope membership without a refresh", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(seed).open),
        );
        yield* client.CitationLookup({
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["shared"],
        });
        const all = yield* client.CitationLookup({
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

it.each([false, true])(
  "refreshes citation answers (changed: %s)",
  async (changed) => {
    let key = "shared";
    const opener = memoryOpener(() =>
      seed().replaceAll("'shared'", `'${key}'`),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* inProcessClient(layerRcRef(opener.open));
          const request = {
            scope: MY_LIBRARY_SCOPE,
            citekeys: ["shared", "renamed"],
            indexedKeys: ["PERSONAL"],
          };
          const first = yield* client.CitationLookup(request);
          if (changed) key = "renamed";
          yield* client.Refresh();
          const next = yield* client.CitationLookup(request);
          if (changed) {
            expect(next.revision).not.toBe(first.revision);
            expect(next.citekeys.get("shared")).toEqual({ kind: "missing" });
            expect(next.citekeys.get("renamed")).toMatchObject({
              kind: "unique",
              item: { indexedKey: "PERSONAL" },
            });
          } else expect(next.revision).toBe(first.revision);
          expect(next.indexedKeys.get("PERSONAL")).toBe(key);
          expect(first.indexedKeys.get("PERSONAL")).toBe("shared");
        }),
      ),
    );
  },
);

it("returns DbUnavailable for a failed build and retries the next lookup", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(seed).open),
        );
        const request = { scope: MY_LIBRARY_SCOPE, citekeys: ["shared"] };
        using _read = vi
          .spyOn(db, "getCitekeyWindow")
          .mockImplementationOnce(() => {
            throw new Error("read failed");
          });
        expect(
          yield* Effect.flip(client.CitationLookup(request)),
        ).toMatchObject({ _tag: "DbUnavailable" });
        expect(
          (yield* client.CitationLookup(request)).citekeys.get("shared"),
        ).toMatchObject({ kind: "unique", item: { indexedKey: "PERSONAL" } });
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
          { citationWindowSize: 1 },
        );
        const request = {
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
          const getWindow = db.getCitekeyWindow;
          using pages = vi
            .spyOn(db, "getCitekeyWindow")
            .mockImplementation((...args) => {
              const rows = getWindow(...args);
              if (phase === "construction") {
                return rows.map((row) => ({
                  ...row,
                  get key() {
                    markWork();
                    return row.key;
                  },
                }));
              }
              return rows;
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
    expect(opener.log).toEqual(["open #1", "close #1"]);
  },
);

it("gives identical databases distinct revisions after a worker restart", async () => {
  const read = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* inProcessClient(
            layerRcRef(memoryOpener(seed).open),
          );
          return yield* client.CitationLookup({
            scope: MY_LIBRARY_SCOPE,
            citekeys: [],
            indexedKeys: [],
          });
        }),
      ),
    );
  expect((await read()).revision).not.toBe((await read()).revision);
});
