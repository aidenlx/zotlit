import type { getItemDisplayRefByID } from "@zotlit/db";

// One item's display ref, read through the `DisplayRefs` stream.
import { Effect, Stream } from "@/lib/effect";

import type { ZoteroReadsApi } from "./service";

/** An item's key, library, and title. */
export type ItemDisplayRef = NonNullable<
  ReturnType<typeof getItemDisplayRefByID>
>;

/**
 * The display ref of the item `itemID` names, or `null` when no live item has
 * that id.
 */
export async function readDisplayRef(
  reads: Pick<ZoteroReadsApi, "DisplayRefs">,
  itemID: number,
): Promise<ItemDisplayRef | null> {
  const slices = await Effect.runPromise(
    Stream.runCollect(reads.DisplayRefs({ itemIDs: [itemID] })),
  );
  return slices.flat()[0]?.ref ?? null;
}
