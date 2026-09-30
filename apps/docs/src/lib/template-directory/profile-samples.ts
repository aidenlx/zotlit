// Which example items a Profile entry renders: the items its Profile Match takes, or every Directory Sample.

import { compileFilter, matchCondition } from "@zotlit/workbench/match";

import { ITEM_TYPES } from "./entry.ts";
import type { DirectoryEntry } from "./load.ts";
import type { DirectorySample } from "./samples.ts";
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
 * The Zotero item types the Profile's match takes, in the order Zotero lists
 * them; null for a Profile with no match, which the reader chooses by hand.
 */
export function matchedItemTypes({
  manifest,
}: Pick<ProfileEntry, "manifest">): readonly string[] | null {
  if (manifest.match === undefined) return null;
  const { condition } = compileFilter(manifest.match);
  if (condition === null) return null;
  return ITEM_TYPES.filter((type) => takesItemType(condition, type));
}

/**
 * The example items of a Profile with a Profile Match: the candidates whose
 * item type the match takes. An item type with example variants shows those
 * variants alone, and the full variant of the Profile's `sampleItemType`
 * comes first, so the page opens on it. `candidates` is what the entry shows
 * when it has no match.
 */
export function matchedSamples(
  { manifest }: Pick<ProfileEntry, "manifest">,
  candidates: readonly DirectorySample[],
): readonly DirectorySample[] {
  if (manifest.match === undefined) return candidates;
  const { condition } = compileFilter(manifest.match);
  if (condition === null) return candidates;
  const takes = ({ snapshot }: DirectorySample) =>
    takesItemType(condition, snapshot.item.itemType);
  const variantTypes = new Set(
    EXAMPLE_VARIANTS.map(({ snapshot }) => snapshot.item.itemType),
  );
  const shown = [
    ...candidates.filter(
      (sample) =>
        sample.variant === undefined &&
        !variantTypes.has(sample.snapshot.item.itemType),
    ),
    ...EXAMPLE_VARIANTS,
  ].filter(takes);
  const opening = shown.find(
    (sample) =>
      sample.snapshot.item.itemType === manifest.sampleItemType &&
      (sample.variant === undefined || sample.variant === "full-details"),
  );
  return opening === undefined
    ? shown
    : [opening, ...shown.filter((sample) => sample !== opening)];
}
