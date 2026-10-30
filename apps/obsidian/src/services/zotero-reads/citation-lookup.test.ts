import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { expect, it, vi } from "vitest";

import * as db from "@zotlit/db";

import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { makeCitationLookup } from "./citation-lookup";
import { Connection, layerRcRef } from "./connection";
import type { HandlersOptions } from "./handlers";
import type { ZoteroReadsClient } from "./in-process";
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

const annotationSeed = () => `${seed()}
${worksSql([{ itemID: 3, key: "NOCITEKY" }])}
insert into itemTypes (itemTypeID, typeName) values (100, 'annotation');
insert into items (itemID, itemTypeID, libraryID, key) values
  (10, 99, 1, 'PDF23456'), (11, 100, 1, 'ANN23456'),
  (20, 99, 2, 'PDF23456'), (21, 100, 2, 'ANN23456'),
  (30, 99, 1, 'PDFSTAND'), (31, 100, 1, 'ANNSTAND'),
  (40, 99, 1, 'PDFNCKEY'), (41, 100, 1, 'ANNNCKEY');
insert into itemAttachments (itemID, parentItemID, linkMode) values
  (10, 1, 0), (20, 2, 0), (30, null, 0), (40, 3, 0);
insert into itemAnnotations (itemID, parentItemID, type) values
  (11, 10, 1), (21, 20, 1), (31, 30, 1), (41, 40, 1);
`;

/**
 * Runs `body` against an in-process client over fixture databases seeded by
 * `seedSql` (open #N runs `seedSql(N)`; `null` fails that open).
 */
function withClient<A, E>(
  body: (client: ZoteroReadsClient) => Effect.Effect<A, E>,
  {
    seedSql = seed,
    options,
  }: {
    seedSql?: (open: number) => string | null;
    options?: HandlersOptions;
  } = {},
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* inProcessClient(
          layerRcRef(memoryOpener(seedSql).open),
          options,
        );
        return yield* body(client);
      }),
    ),
  );
}

it("resolves Annotations to their parent Item and Citation Key across Libraries, distinguishing missing from unkeyed parents (#1690)", async () => {
  await withClient(
    (client) =>
      Effect.gen(function* () {
        const answer = new CitationLookupAnswer(
          yield* client.CitationLookup({
            scope: MY_LIBRARY_SCOPE,
            annotationKeys: [
              "ANN23456",
              "ANN23456g7",
              "ANNSTAND",
              "ANNNCKEY",
              "ZZZZZZZZ",
              "ANN23456g8",
              "PDF23456",
            ],
          }),
        );
        expect(answer.parentOfAnnotation("ANN23456")).toEqual({
          indexedKey: "PERSONAL",
          citekey: "shared",
        });
        expect(answer.parentOfAnnotation("ANN23456g7")).toEqual({
          indexedKey: "GROUPKEYg7",
          citekey: "shared",
        });
        expect(answer.parentOfAnnotation("ANNSTAND")).toEqual({
          indexedKey: "PDFSTAND",
          citekey: null,
        });
        expect(answer.parentOfAnnotation("ANNNCKEY")).toEqual({
          indexedKey: "NOCITEKY",
          citekey: null,
        });
        expect(answer.parentOfAnnotation("ZZZZZZZZ")).toBeNull();
        expect(answer.parentOfAnnotation("ANN23456g8")).toBeNull();
        expect(answer.parentOfAnnotation("PDF23456")).toBeNull();
      }),
    { seedSql: annotationSeed },
  );
});

it("rejects an unrequested Annotation key even when it exists (#1690)", async () => {
  await withClient(
    (client) =>
      Effect.gen(function* () {
        const answer = new CitationLookupAnswer(
          yield* client.CitationLookup({
            scope: MY_LIBRARY_SCOPE,
            annotationKeys: ["ZZZZZZZZ"],
          }),
        );
        expect(answer.coversAnnotationKey("ZZZZZZZZ")).toBe(true);
        expect(answer.coversAnnotationKey("ANN23456")).toBe(false);
        expect(() => answer.parentOfAnnotation("ANN23456")).toThrow(
          'Annotation Indexed Key "ANN23456" was not requested',
        );
      }),
    { seedSql: annotationSeed },
  );
});

it("keeps DbUnavailable distinct from a missing Annotation (#1690)", async () => {
  let available = false;
  await withClient(
    (client) =>
      Effect.gen(function* () {
        const request = {
          scope: MY_LIBRARY_SCOPE,
          annotationKeys: ["ZZZZZZZZ"],
        };
        expect(
          yield* Effect.flip(client.CitationLookup(request)),
        ).toMatchObject({ _tag: "DbUnavailable" });
        available = true;
        yield* client.Refresh();
        const answer = new CitationLookupAnswer(
          yield* client.CitationLookup(request),
        );
        expect(answer.parentOfAnnotation("ZZZZZZZZ")).toBeNull();
      }),
    { seedSql: () => (available ? annotationSeed() : null) },
  );
});

it("reads moved Annotations and reparented Attachments from the refreshed copy, keeping the revision because no Citation Key changed (#1690)", async () => {
  let changes = "";
  await withClient(
    (client) =>
      Effect.gen(function* () {
        const request = {
          scope: MY_LIBRARY_SCOPE,
          annotationKeys: ["ANN23456", "ANNNCKEY"],
        };
        const first = new CitationLookupAnswer(
          yield* client.CitationLookup(request),
        );
        changes =
          "update itemAnnotations set parentItemID = 30 where itemID = 11; update itemAttachments set parentItemID = 1 where itemID = 40;";
        yield* client.Refresh();
        const next = new CitationLookupAnswer(
          yield* client.CitationLookup(request),
        );
        expect(next.parentOfAnnotation("ANN23456")).toEqual({
          indexedKey: "PDFSTAND",
          citekey: null,
        });
        expect(next.parentOfAnnotation("ANNNCKEY")).toEqual({
          indexedKey: "PERSONAL",
          citekey: "shared",
        });
        expect(first.parentOfAnnotation("ANN23456")).toEqual({
          indexedKey: "PERSONAL",
          citekey: "shared",
        });
        expect(next.revision).toBe(first.revision);
      }),
    { seedSql: () => annotationSeed() + changes },
  );
});

it("answers one requested batch with scope-limited forward and all-library reverse lookups", async () => {
  await withClient(
    (client) =>
      Effect.gen(function* () {
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
    { options: { citationWindowSize: 1 } },
  );
});

it("changes scope membership without a refresh", async () => {
  await withClient((client) =>
    Effect.gen(function* () {
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
        candidates: [{ indexedKey: "PERSONAL" }, { indexedKey: "GROUPKEYg7" }],
      });
    }),
  );
});

it.each([false, true])(
  "refreshes citation answers (changed: %s)",
  async (changed) => {
    let key = "shared";
    await withClient(
      (client) =>
        Effect.gen(function* () {
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
      { seedSql: () => seed().replaceAll("'shared'", `'${key}'`) },
    );
  },
);

it("retries a failed old-client build after refresh", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const joined = yield* Deferred.make<void>();
        let borrows = 0;
        const connection = Layer.effect(Connection)(
          Effect.gen(function* () {
            const source = yield* Connection;
            return {
              ...source,
              borrow: Effect.tap(source.borrow, () => {
                borrows += 1;
                if (borrows === 2)
                  return Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                  );
                if (borrows === 3) return Deferred.succeed(joined, undefined);
                return Effect.void;
              }),
            };
          }),
        ).pipe(Layer.provide(layerRcRef(memoryOpener(seed).open)));
        const client = yield* inProcessClient(connection);
        const request = { scope: MY_LIBRARY_SCOPE, citekeys: ["shared"] };
        using pages = vi
          .spyOn(db, "getCitekeyWindow")
          .mockImplementationOnce(() => {
            throw new Error("old client failed");
          });
        const old = yield* Effect.forkChild(client.CitationLookup(request));
        yield* Deferred.await(entered);
        yield* client.Refresh();
        const current = yield* Effect.forkChild(client.CitationLookup(request));
        yield* Deferred.await(joined);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const answer = yield* Fiber.join(current);
        expect(answer.citekeys.get("shared")).toMatchObject({
          kind: "unique",
          item: { indexedKey: "PERSONAL" },
        });
        expect((yield* Fiber.join(old)).revision).toBe(answer.revision);
        expect(pages).toHaveBeenCalledTimes(2);
      }),
    ),
  );
});

it("returns DbUnavailable for a failed build and retries the next lookup", async () => {
  await withClient((client) =>
    Effect.gen(function* () {
      const request = { scope: MY_LIBRARY_SCOPE, citekeys: ["shared"] };
      using _read = vi
        .spyOn(db, "getCitekeyWindow")
        .mockImplementationOnce(() => {
          throw new Error("read failed");
        });
      expect(yield* Effect.flip(client.CitationLookup(request))).toMatchObject({
        _tag: "DbUnavailable",
      });
      expect(
        (yield* client.CitationLookup(request)).citekeys.get("shared"),
      ).toMatchObject({ kind: "unique", item: { indexedKey: "PERSONAL" } });
    }),
  );
});

it("continues a shared worker build after one caller cancels", async () => {
  const works = Array.from({ length: 1000 }, (_, index) => ({
    itemID: index + 1,
    key: `K${String(index).padStart(7, "0")}`,
    citationKey: `key${index}`,
  }));
  await withClient(
    (client) =>
      Effect.gen(function* () {
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
    {
      seedSql: () => seedWorksSql(works),
      options: { citationWindowSize: 1 },
    },
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
    withClient((client) =>
      client.CitationLookup({
        scope: MY_LIBRARY_SCOPE,
        citekeys: [],
        indexedKeys: [],
      }),
    );
  expect((await read()).revision).not.toBe((await read()).revision);
});
