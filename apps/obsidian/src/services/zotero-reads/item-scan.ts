// Bounded enumeration shared by Item Index builds and whole-Library batch selection.
import { Effect, Stream } from "effect";
// oxlint-disable-next-line no-restricted-imports -- ItemQueryScheduler preserves MessageChannel scheduling and bounds the batch merge's work per turn.
import { Scheduler } from "effect";

import { getIndexedItemRowsRange, getItemIDBounds } from "@zotlit/db";
import type { IndexedItemScopeRow } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryScheduler } from "@zotlit/item-query";
import { makeSortedRuns } from "@zotlit/shared/sorted-runs";

import { toDbUnavailable } from "./connection";

/** Maximum Item ID span of one read, and rows of one sorting step. */
const ITEM_RANGE = 500;

/** The caller keeps `client` borrowed until the stream finishes or is interrupted. */
export const scanIndexedItems = (
  client: NodeDatabaseClient,
  libraryID: number,
) =>
  Stream.unwrap(
    Effect.map(
      Effect.try({
        try: () => getItemIDBounds(client, libraryID),
        catch: toDbUnavailable,
      }),
      (bounds) =>
        bounds === null
          ? Stream.empty
          : Stream.unfold(
              bounds.min,
              Effect.fnUntraced(function* (from: number) {
                if (from > bounds.max) return undefined;
                yield* Effect.yieldNow;
                const to = from + ITEM_RANGE;
                const rows = yield* Effect.try({
                  try: () =>
                    getIndexedItemRowsRange(client, libraryID, { from, to }),
                  catch: toDbUnavailable,
                });
                return [rows, to] as const;
              }),
            ),
    ),
  );

/** Preserve newest-first batch order while the scan and merge share the worker. */
export const readIndexedItemIDs = (
  client: NodeDatabaseClient,
  libraryID: number,
) =>
  Effect.suspend(() =>
    Effect.gen(function* () {
      const sorted = makeSortedRuns<IndexedItemScopeRow>(
        (a, b) =>
          (a.dateModified < b.dateModified
            ? 1
            : a.dateModified > b.dateModified
              ? -1
              : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        ITEM_RANGE,
      );
      yield* Stream.runForEach(scanIndexedItems(client, libraryID), (rows) =>
        Effect.sync(() => sorted.add(rows)),
      );
      return (yield* sorted.ordered()).map((row) => row.itemID);
    }).pipe(
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    ),
  );
