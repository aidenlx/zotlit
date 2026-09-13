// Only complete snapshot membership data can answer the selected-paper result.
import type { ItemSnapshot } from "#/snapshot/types";

import type { MatchItemFacts } from "./condition";

export function snapshotMatchFacts(
  snapshot: ItemSnapshot | null,
): MatchItemFacts | null {
  if (!snapshot) return null;
  const { tags, collections } = snapshot.roots.note;
  if (!Array.isArray(tags) || !Array.isArray(collections)) return null;
  const names: string[] = [];
  for (const tag of tags) {
    if (
      typeof tag !== "object" ||
      tag === null ||
      !("name" in tag) ||
      typeof tag.name !== "string"
    )
      return null;
    names.push(tag.name);
  }
  const paths: string[][] = [];
  for (const collection of collections) {
    if (
      typeof collection !== "object" ||
      collection === null ||
      !("path" in collection) ||
      !Array.isArray(collection.path) ||
      !collection.path.every((segment: unknown) => typeof segment === "string")
    )
      return null;
    paths.push(collection.path);
  }
  return {
    library: snapshot.item.library,
    itemType: snapshot.item.itemType,
    tags: names,
    collections: paths,
  };
}
