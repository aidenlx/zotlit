// The Item Query side of the Layout module (`src/layout/`): the typed failure
// of a copy the readers cannot read. The layout read and the manifest live in
// the synchronous core; `database.ts` runs the read through the statement seam
// of the readers.
import { Data } from "effect";

import type { NodeDatabaseClient } from "@/client/node";
import { describeLayoutGaps, readDatabaseLayout } from "@/layout";
import type { DatabaseLayout, LayoutGap, LayoutVersions } from "@/layout";

export type { LayoutGap, LayoutVersions } from "@/layout";

/**
 * The Zotero database lacks a table or column that Item Query reads. The
 * version stamps do not decide this; the layout of the copy does.
 */
export class ItemQueryLayoutError extends Data.TaggedError(
  "ItemQueryLayoutError",
)<{
  /** What the copy lacks, in manifest order. */
  readonly missing: readonly LayoutGap[];
  readonly versions: LayoutVersions;
}> {
  override get message(): string {
    return `This version of ZotLit cannot read the data layout of this Zotero database. Missing: ${describeLayoutGaps(this.missing)}. Update ZotLit to read it.`;
  }
}

/** The failure of a copy with `layout`, or `null` when the readers can read it. */
export function layoutErrorOf(
  layout: DatabaseLayout,
): ItemQueryLayoutError | null {
  return layout.missing.length === 0
    ? null
    : new ItemQueryLayoutError({
        missing: layout.missing,
        versions: layout.versions,
      });
}

/**
 * Read the layout of the copy behind `client`, once for each copy, and throw
 * {@link ItemQueryLayoutError} when the readers cannot read it. This is the
 * synchronous form of the check that the first reader statement on a copy
 * runs. A failed statement throws the driver error.
 */
export function checkDatabaseLayout(
  client: NodeDatabaseClient,
): DatabaseLayout {
  const layout = readDatabaseLayout(client);
  const error = layoutErrorOf(layout);
  if (error) throw error;
  return layout;
}
