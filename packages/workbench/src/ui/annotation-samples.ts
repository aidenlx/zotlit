// Selection resolves by source and Indexed Key, so refreshing or reordering an item preserves its example.

import type { AnnotationExample } from "#/render/index";
import type { ItemSnapshot } from "#/snapshot/index";

import { SAMPLE_ANNOTATIONS } from "#/render/index";

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
