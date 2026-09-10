// Canonical native selections for the Workbench's built-in Item snapshots.
import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import type { WorkbenchItemChoice } from "@zotlit/workbench/ui";

const samples = new Map<string, ItemSnapshot>(
  SAMPLE_ITEMS.flatMap((snapshot) =>
    snapshot.provenance.kind === "sample"
      ? [[`sample:${snapshot.provenance.id}`, snapshot] as const]
      : [],
  ),
);

export const SAMPLE_ITEM_CHOICES: readonly WorkbenchItemChoice[] = [
  ...samples,
].map(([id, snapshot]) => ({ id, title: snapshot.item.title }));

export function getSampleItem(id: string): ItemSnapshot | null {
  return samples.get(id) ?? null;
}

export function getSampleItemType(id: string): string | null {
  return getSampleItem(id)?.item.itemType ?? null;
}

/** Supplies the render input for an explicit annotation without selecting a note Item. */
export function getSampleAnnotationParent(id: string): ItemSnapshot | null {
  const parent = SAMPLE_ANNOTATIONS.find((sample) => sample.id === id)?.root
    .parentItem as Record<string, unknown> | undefined;
  return (
    SAMPLE_ITEMS.find(
      (sample) => sample.item.indexedKey === parent?.indexedKey,
    ) ?? null
  );
}
