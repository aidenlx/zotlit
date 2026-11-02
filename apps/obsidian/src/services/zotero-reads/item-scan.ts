// Bounded enumeration shared by Item Index builds and whole-Library batch selection.
import { Effect, Stream } from "effect";
// oxlint-disable-next-line no-restricted-imports -- ItemQueryScheduler preserves MessageChannel scheduling and bounds the batch merge's work per turn.
import { Scheduler } from "effect";

import { getIndexedItemRowsRange, getItemIDBounds } from "@zotlit/db";
import type { IndexedItemScanRow } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryScheduler } from "@zotlit/item-query";
import { makeSortedRuns } from "@zotlit/shared/sorted-runs";

import { read } from "./connection";

/** Item IDs one scan read spans; a sparse range reads fewer rows. */
const SCAN_ID_SPAN = 500;

/** Rows one merge step of the newest-first sort orders. */
const MERGE_STEP_ROWS = 500;

/** The caller keeps `client` borrowed until the stream finishes or is interrupted. */
export const scanIndexedItems = (
  client: NodeDatabaseClient,
  libraryID: number,
) =>
  Stream.unwrap(
    Effect.map(
      read(client, (c) => getItemIDBounds(c, libraryID)),
      (bounds) =>
        bounds === null
          ? Stream.empty
          : Stream.unfold(
              bounds.min,
              // Untraced: runs once per Item ID span of the scan.
              Effect.fnUntraced(function* (from: number) {
                if (from > bounds.max) return undefined;
                yield* Effect.yieldNow;
                const to = from + SCAN_ID_SPAN;
                const rows = yield* read(client, (c) =>
                  getIndexedItemRowsRange(c, libraryID, { from, to }),
                );
                return [rows, to] as const;
              }),
            ),
    ),
  );

/** Preserve newest-first batch order while the scan and merge share the worker. */
export const readIndexedItemIDs = Effect.fn("readIndexedItemIDs")(
  function* (client: NodeDatabaseClient, libraryID: number) {
    const sorted = makeSortedRuns<IndexedItemScanRow>(
      (a, b) =>
        (a.dateModified < b.dateModified
          ? 1
          : a.dateModified > b.dateModified
            ? -1
            : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      MERGE_STEP_ROWS,
    );
    yield* Stream.runForEach(scanIndexedItems(client, libraryID), (rows) =>
      Effect.sync(() => sorted.add(rows)),
    );
    return (yield* sorted.ordered()).map((row) => row.itemID);
  },
  (effect) =>
    Effect.provideService(
      effect,
      Scheduler.Scheduler,
      new ItemQueryScheduler(),
    ),
);
