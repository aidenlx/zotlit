import {
  getItemsByLibraryAsync,
  getLibrariesAsync,
  type Item,
  type Library,
} from "@zotlit/db";
import { createClient } from "@zotlit/db/client/web";

export type { Item, ItemDate, Library } from "@zotlit/db";

const sqlocal = createClient("zotero.sqlite");

export async function loadDatabaseFile(file: File): Promise<void> {
  await sqlocal.$client.overwriteDatabaseFile(file);
}

export function fetchLibraries(): Promise<Library[]> {
  return getLibrariesAsync(sqlocal);
}

export async function fetchItems(libraryID: number): Promise<Item[]> {
  const items = await getItemsByLibraryAsync(sqlocal, libraryID, {
    lookup: null,
  });
  return items.slice(0, 50);
}
