// Match vocabulary spans every Library in the pinned live database.
import {
  getItemsByKey,
  resolveIndexedKeyLibrary,
  getLibraries,
} from "@zotlit/db";
import type { MatchItemFacts } from "@zotlit/workbench/match";
import { snapshotMatchFacts } from "@zotlit/workbench/match";
import type { WorkbenchHost, WorkbenchLibrary } from "@zotlit/workbench/ui";

import type { DatabaseService } from "@/services/database/service";
import {
  resolveLibraryScope,
  selectorKey,
} from "@/services/library-scope/scope";
import {
  listCollectionChoices,
  resolveMembershipFacts,
} from "@/services/profile-selection/facts";

import { getSampleItem } from "./selection-data";

export function createMatchData(
  db: Pick<DatabaseService, "acquireRead">,
): WorkbenchHost["matchData"] {
  return {
    async tags() {
      using lease = await db.acquireRead();
      const rows = lease.client.query.tags
        .findMany({ columns: { name: true } })
        .sync();
      return [...new Set(rows.map((row) => row.name))].sort((a, b) =>
        a.localeCompare(b),
      );
    },
    async collections() {
      using lease = await db.acquireRead();
      const libraries = resolveLibraryScope(getLibraries(lease.client), {
        mode: "all",
      }).available;
      return listCollectionChoices(lease.client, libraries).map(
        ({ path }) => path,
      );
    },
    async libraries() {
      using lease = await db.acquireRead();
      return resolveLibraryScope(getLibraries(lease.client), {
        mode: "all",
      }).available.map((library) => ({
        id: selectorKey(library.selector) as WorkbenchLibrary["id"],
        ...(library.name === null ? {} : { name: library.name }),
      }));
    },
  };
}

/** The Item's real memberships, including automatic Tags and direct Collections. */
export async function loadMatchFacts(
  db: Pick<DatabaseService, "acquireRead">,
  indexedKey: string,
): Promise<MatchItemFacts | null> {
  const sample = getSampleItem(indexedKey);
  if (sample) return snapshotMatchFacts(sample);
  using lease = await db.acquireRead();
  const key = resolveIndexedKeyLibrary(lease.client, indexedKey);
  if (!key) return null;
  const item = getItemsByKey(lease.client, key.libraryID, [key.key])[0];
  if (!item) return null;
  const library = resolveLibraryScope(getLibraries(lease.client), {
    mode: "all",
  }).available.find((entry) => entry.libraryID === item.libraryID);
  if (!library) return null;
  return {
    library: library.selector,
    itemType: item.fields.itemType,
    ...resolveMembershipFacts(lease.client, item),
  };
}
