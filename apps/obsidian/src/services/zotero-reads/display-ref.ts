// One item's display ref, read through the `DisplayRefs` stream.
import { Effect, Stream } from "effect";
import type { RpcClientError } from "effect/rpc";

import type { getItemDisplayRefByID } from "@zotlit/db";

import type { DbUnavailable, SnapshotExpired } from "./rpc";
import type { ZoteroReadsApi } from "./service";

/** An item's key, library, and title. */
export type ItemDisplayRef = NonNullable<
  ReturnType<typeof getItemDisplayRefByID>
>;

/**
 * The display ref of the item `itemID` names, or `null` when no live item has
 * that id.
 */
export const readDisplayRef = Effect.fn("readDisplayRef")(function* (
  reads: Pick<ZoteroReadsApi, "DisplayRefs">,
  itemID: number,
): Effect.fn.Return<
  ItemDisplayRef | null,
  DbUnavailable | SnapshotExpired | RpcClientError.RpcClientError
> {
  const slices = yield* Stream.runCollect(
    reads.DisplayRefs({ itemIDs: [itemID] }),
  );
  return slices.flat()[0]?.ref ?? null;
});
