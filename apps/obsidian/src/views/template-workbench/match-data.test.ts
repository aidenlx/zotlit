import { expect, it } from "@effect/vitest";
// Vault-wide suggestions and the Match test of a real Item read one database.
import { Effect, Exit, Fiber } from "effect";
import { vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { makeViewRunner } from "@/lib/view-runner";
import { buildQueryService } from "@/services/item-query/__fixtures__";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { makeWorkbenchHost } from "./__fixtures__";
import type { WorkbenchHostDeps } from "./__fixtures__";
import { createMatchData } from "./match-data";

/** Match data over one fixture database, with the lease releases counted. */
async function openMatchData(stack: AsyncDisposableStack) {
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID,type) values (1,'user'), (2,'group');
    insert into groups (groupID,libraryID,name) values (118,2,'Team');
    insert into itemTypes (itemTypeID,typeName) values (1,'book');
    insert into items (itemID,itemTypeID,libraryID,key) values (1,1,1,'BKKKK222');
    update items set dateAdded='2026-01-01 00:00:00',dateModified='2026-01-01 00:00:00',clientDateModified='2026-01-01 00:00:00';
    insert into tags (tagID,name) values (1,'Manual'), (2,'Automatic'), (3,'Other paper');
    insert into itemTags (itemID,tagID,type) values (1,1,0), (1,2,1);
    insert into collections (collectionID,collectionName,parentCollectionID,libraryID,key) values (1,'Project',null,1,'PROJ0001'), (2,'Drafts',1,1,'DRFT0001'), (3,'Team only',null,2,'TEAM0001'), (4,'A/B',null,1,'SLASH222');
    insert into collectionItems (collectionID,itemID) values (2,1), (4,1);
  `);
  const service = stack.use(inProcessReadsService(sharedClientOpener(client)));
  const dispose = vi.fn();
  const db = {
    acquireRead: async () => {
      const lease = await service.acquireRead();
      return {
        reads: lease.reads,
        [Symbol.asyncDispose]: () => {
          dispose();
          return lease[Symbol.asyncDispose]();
        },
      };
    },
  };
  const { handle: query } = await buildQueryService(
    {
      reads: service.reads,
      source: {
        sourceId: "match-data",
        databasePath: ":memory:",
        dataDir: "/zotero",
        baseAttachmentPath: "/zotero/linked",
      },
      vaultName: "Match tests",
      basePath: "/vault",
    },
    stack,
  );
  const host = makeWorkbenchHost({
    zoteroReads: stubService<WorkbenchHostDeps["zoteroReads"]>(
      "ZoteroReads",
      db,
    ),
    query,
  });
  const data = createMatchData(
    stack.use(makeViewRunner(host.registry)).provide,
  );
  return { data, dispose };
}

it.effect(
  "includes Libraries outside the chosen paper and keeps automatic Tags and direct Collection paths",
  () =>
    Effect.gen(function* () {
      const stack = yield* Effect.acquireRelease(
        Effect.sync(() => new AsyncDisposableStack()),
        (stack) => Effect.promise(() => stack.disposeAsync()),
      );
      const { data, dispose } = yield* Effect.promise(() =>
        openMatchData(stack),
      );
      expect(yield* data.tags).toEqual(["Automatic", "Manual", "Other paper"]);
      // ADR 0040 accepts slash ambiguity in expressions; provider facts retain real segments.
      expect(yield* data.collections).toEqual([
        ["A/B"],
        ["Project"],
        ["Project", "Drafts"],
        ["Team only"],
      ]);
      expect(yield* data.libraries).toEqual([
        { id: "personal" },
        { id: "group:118", name: "Team" },
      ]);
      // Automatic Tags and direct Collection paths count, as in selection.
      for (const [filter, matched] of [
        ['itemType == "book" && library == "personal"', true],
        ['tags.containsAll("Automatic", "Manual")', true],
        ['collections.contains("Project/Drafts")', true],
        ['collections.contains("Project")', false],
        ['collections.within("Project")', true],
        ['tags.contains("Other paper")', false],
      ] as const)
        expect(yield* data.matches("BKKKK222", filter), filter).toEqual({
          kind: "result",
          matched,
        });
      // The Workbench shows the Match pane twice; overlapping tests both answer.
      expect(
        yield* Effect.all(
          [data.matches("BKKKK222", "true"), data.matches("BKKKK222", "false")],
          { concurrency: "unbounded" },
        ),
      ).toEqual([
        { kind: "result", matched: true },
        { kind: "result", matched: false },
      ]);
      expect(yield* data.matches("ABSENT22", "true")).toEqual({
        kind: "missing",
      });
      expect(yield* data.matches("BKKKK222", "tags.contain(1)")).toMatchObject({
        kind: "problem",
        span: { from: 5, to: 12 },
      });
      expect(dispose).toHaveBeenCalledTimes(3);
    }),
);

it.effect(
  "stops reading custom fields when the Match editor interrupts the read",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<AbortSignal>();
      const customFieldNames = vi.fn((signal: AbortSignal) => {
        started.resolve(signal);
        return new Promise<never>(() => {});
      });
      const host = makeWorkbenchHost({
        query: stubService<NonNullable<WorkbenchHostDeps["query"]>>("Query", {
          customFieldNames,
        }),
      });
      const runner = yield* Effect.acquireDisposable(
        Effect.sync(() => makeViewRunner(host.registry)),
      );
      const data = createMatchData(runner.provide);
      const fiber = yield* Effect.forkChild(data.customFields);
      const running = yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
      yield* Effect.promise(() =>
        waitFor(() => expect(running.aborted).toBe(true)),
      );
      expect(customFieldNames).toHaveBeenCalledOnce();
    }),
);

// #1819: concurrent reads stop when the view closes, before the registry's idle expiry.
it.effect("stops every concurrent read when its view closes", () =>
  Effect.gen(function* () {
    const signals: AbortSignal[] = [];
    const host = makeWorkbenchHost({
      query: stubService<NonNullable<WorkbenchHostDeps["query"]>>("Query", {
        customFieldNames: (signal) => {
          signals.push(signal);
          return new Promise<never>(() => {});
        },
      }),
    });
    const runner = makeViewRunner(host.registry);
    const data = createMatchData(runner.provide);
    const fibers = [
      runner.run(data.customFields),
      runner.run(data.customFields),
    ];
    yield* Effect.promise(() => waitFor(() => expect(signals).toHaveLength(2)));
    yield* Effect.promise(() => runner[Symbol.asyncDispose]());
    for (const fiber of fibers)
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  }),
);
