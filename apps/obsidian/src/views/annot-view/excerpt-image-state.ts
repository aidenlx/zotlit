// What one Annotation card paints: the demand it states, and the object URL it
// owns for the image the shared display read holds.

import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type { ExcerptImageDisplay } from "@/services/excerpt-image/display";
import type { ExcerptImage } from "@/services/excerpt-image/format";
import {
  excerptFingerprint,
  excerptSourceIdentity,
} from "@/services/excerpt-image/service";

export interface ExcerptImageTarget {
  /**
   * The demanded inputs, as one comparable string: two records that ask for the
   * same pixels are one target, so a list refresh that moved only a comment,
   * a tag, or the record's version states the same demand again.
   */
  key: string;
  /**
   * The Annotation and source the card paints, across pixel changes. The shared
   * display read is held under this identity, so a replacement keeps painting
   * the previous image of the same Annotation.
   */
  identity: string;
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
  sourceScope: string | null;
}

/** Retain the stated demand when a published list changes only non-pixel input. */
export function excerptImageTarget(
  previous: ExcerptImageTarget | null,
  input: Omit<ExcerptImageTarget, "key" | "identity">,
): ExcerptImageTarget {
  const { annotation } = input;
  const identity = JSON.stringify([
    annotation.key,
    annotation.parentKey,
    input.sourceScope,
    input.source && excerptSourceIdentity(input.source),
  ]);
  const key = JSON.stringify([identity, excerptFingerprint(annotation)]);
  return previous?.key === key ? previous : { key, identity, ...input };
}

/** One card's object URL, and the image it was made from. */
export interface ExcerptImageOwnership {
  identity: string;
  image: ExcerptImage;
  url: string;
}

/**
 * Move one card's object URL onto the image it paints now.
 *
 * The previous URL stays while the display has nothing newer to paint — during a
 * replacement and after a failed one, where the last image is still the best
 * thing the card has. It is released the moment the image it was made from is
 * replaced, the card paints another Annotation, or a manual clear released the
 * display, which removed that image with the bytes behind it.
 *
 * @param options.create makes one object URL, which the caller owns from then on.
 * @returns the URL the card holds, and the URLs it must revoke.
 */
export function excerptImageOwnership(options: {
  held: ExcerptImageOwnership | null;
  display: ExcerptImageDisplay;
  identity: string;
  create: (image: ExcerptImage) => string;
}): { owned: ExcerptImageOwnership | null; release: string[] } {
  const { held, display, identity, create } = options;
  const image = display.image;
  const keep =
    held &&
    held.identity === identity &&
    display.status !== "cleared" &&
    (image === null || image === held.image);
  if (keep) return { owned: held, release: [] };
  const url = image ? create(image) : null;
  const owned = image && url ? { identity, image, url } : null;
  return { owned, release: held ? [held.url] : [] };
}
