// Selection resolves by source and Indexed Key, so refreshing or reordering an item preserves its example.

import type { AnnotationExample } from "#/render/index";
import type { ItemSnapshot } from "#/snapshot/index";

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#/render/index";

export function annotationSamples(
  snapshot: ItemSnapshot,
  selection: string | null,
) {
  const source =
    snapshot.provenance.kind === "sample"
      ? `sample:${snapshot.provenance.id}`
      : `connected:${snapshot.provenance.installationId}`;
  const current: readonly AnnotationExample[] = snapshot.roots.annotations.map(
    (root, index) => ({
      id: JSON.stringify([source, root.indexedKey]),
      revision: snapshot.revision,
      root,
      descriptors: snapshot.descriptors.annotations[index]!,
    }),
  );
  const example =
    [...current, ...SAMPLE_ANNOTATIONS].find(({ id }) => id === selection) ??
    current[0] ??
    SAMPLE_ANNOTATIONS[0]!;
  return { current, example };
}

/** The chosen Item's annotations, and the one the examples render. */
export interface AnnotationExamples {
  readonly current: readonly AnnotationExample[];
  /** Null while the chosen Item's data is still being read. */
  readonly example: AnnotationExample | null;
}

const NO_EXAMPLES: AnnotationExamples = { current: [], example: null };

/**
 * The examples one reader's choice names. With no Item chosen, a Sample
 * Annotation named by id stands alone; a chosen Item offers its own
 * annotations once its data is read.
 */
export function annotationExamples(
  chosen: boolean,
  snapshot: ItemSnapshot | null,
  annotationId: string | null,
): AnnotationExamples {
  if (!chosen)
    return {
      current: [],
      example:
        SAMPLE_ANNOTATIONS.find((sample) => sample.id === annotationId) ?? null,
    };
  return snapshot ? annotationSamples(snapshot, annotationId) : NO_EXAMPLES;
}

/** The Sample Item a Sample Annotation belongs to, which renders it with no Item chosen. */
export function sampleAnnotationParent(id: string): ItemSnapshot | null {
  const parent = SAMPLE_ANNOTATIONS.find((sample) => sample.id === id)?.root
    .parentItem as Record<string, unknown> | undefined;
  return (
    SAMPLE_ITEMS.find(
      (sample) => sample.item.indexedKey === parent?.indexedKey,
    ) ?? null
  );
}
