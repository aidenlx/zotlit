// One Item read for a user action: Quick Switch, Library View rows and citation inserts.
import { Effect } from "effect";

import type { Item } from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";

import { ZoteroReads } from "./service";

/**
 * The Item `indexedKey` names, read on a pinned snapshot: `null` when the key
 * names no Item, or when the read fails (logged). An interrupt passes on.
 */
export const readActionItem = (
  indexedKey: string,
): Effect.Effect<Item | null, never, ZoteroReads> =>
  Effect.gen(function* () {
    const snapshot = yield* (yield* ZoteroReads).snapshot;
    const items = yield* snapshot.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    return items.get(indexedKey) ?? null;
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logWarning("Could not read an Item").pipe(
          Effect.annotateLogs({ indexedKey, cause }),
        ),
      Effect.succeed(null),
    ),
    withLogCategory("zotero-reads"),
  );
