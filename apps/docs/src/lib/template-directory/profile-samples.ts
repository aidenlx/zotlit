// Which example items a Profile entry renders: the variants of the item types its Profile Match takes, or a fixed set across item types.

import { compileFilter, matchCondition } from "@zotlit/workbench/match";

import { ITEM_TYPES } from "./entry.ts";
import type { DirectoryEntry } from "./load.ts";
import type { DirectorySample, VariantKind } from "./samples.ts";
import { EXAMPLE_VARIANTS } from "./samples.ts";

type ProfileEntry = Extract<DirectoryEntry, { kind: "profile" }>;

/** Whether the Profile Match takes an item of `itemType`, whatever its Library, tags, and collections. */
function takesItemType(
  condition: Parameters<typeof matchCondition>[0],
  itemType: string,
): boolean {
  return matchCondition(condition, {
    library: null,
    itemType,
    tags: [],
    collections: [],
  });
}

/**
 * The Zotero item types the Profile's match takes: first those its entry
 * lists in `itemTypes`, in that order, then any other in the order Zotero
 * lists them; null for a Profile with no match, which the reader chooses by
 * hand.
 */
export function matchedItemTypes({
  manifest,
  itemTypes,
}: Pick<ProfileEntry, "manifest" | "itemTypes">): readonly string[] | null {
  if (manifest.match === undefined) return null;
  const { condition } = compileFilter(manifest.match);
  if (condition === null) return null;
  const listed = (type: string) => {
    const index = itemTypes.indexOf(type);
    return index === -1 ? itemTypes.length : index;
  };
  return ITEM_TYPES.filter((type) => takesItemType(condition, type)).sort(
    (a, b) => listed(a) - listed(b),
  );
}

/**
 * The example variants a Profile with no Profile Match switches across: an
 * article, a book, a book chapter, and one item with no annotations.
 */
const CROSS_TYPE_SET: readonly string[] = [
  "journal-article-full-details",
  "book-full-details",
  "book-section-full-details",
  "journal-article-no-annotations",
];

const variant = (kind: VariantKind, itemType: string | undefined) =>
  EXAMPLE_VARIANTS.find(
    (sample) =>
      sample.variant === kind && sample.snapshot.item.itemType === itemType,
  );

/** The full example of an item type: every detail, an abstract, and an annotation set. */
export function fullExample(
  itemType: string | undefined,
): DirectorySample | undefined {
  return variant("full-details", itemType);
}

/**
 * The example items of a Profile entry, opening on the full example of its
 * `sampleItemType`.
 *
 * - A Profile with a Profile Match shows only items its match takes: the full
 *   variant of each item type it takes, then, for its `sampleItemType`, the
 *   few-details and no-annotations variants. A Profile for one item type
 *   therefore shows that type's three variants.
 * - A Profile with no match shows a fixed set across item types, after the
 *   full variant of its `sampleItemType` when the set lacks it.
 *
 * `extras` are further items the entry shows, such as the note with an
 * annotation in every color; a match keeps those it takes.
 */
export function profileExamples(
  entry: Pick<ProfileEntry, "manifest" | "itemTypes">,
  extras: readonly DirectorySample[],
): readonly DirectorySample[] {
  const { sampleItemType } = entry.manifest;
  const types = matchedItemTypes(entry);
  const shown =
    types === null
      ? [
          ...CROSS_TYPE_SET.flatMap(
            (id) => EXAMPLE_VARIANTS.find((sample) => sample.id === id) ?? [],
          ),
          ...extras,
        ]
      : [
          ...types.flatMap((type) => fullExample(type) ?? []),
          ...(["few-details", "no-annotations"] as const).flatMap(
            (kind) => variant(kind, sampleItemType) ?? [],
          ),
          ...extras,
        ].filter(({ snapshot }) => types.includes(snapshot.item.itemType));
  const opening = fullExample(sampleItemType);
  if (opening === undefined) return shown;
  return [opening, ...shown.filter((sample) => sample !== opening)];
}
