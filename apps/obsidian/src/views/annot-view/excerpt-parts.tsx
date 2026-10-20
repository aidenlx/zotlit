// What every surface that shows an Annotation draws the same way: its quoted
// text, its Excerpt Image, and its page locator. The Annotation View's card and
// the Annotation Popover both render through these.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isPageNumber } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import { cn } from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { ExcerptDisplayDemand } from "@/services/excerpt-image/display";
import type { ExcerptImage } from "@/services/excerpt-image/format";

import { excerptImageOwnership } from "./excerpt-image-state";
import type { ExcerptImageOwnership } from "./excerpt-image-state";

/**
 * The page locator of one Annotation: `p. 2` for a page number, and Zotero's
 * own label as stored for anything else — a roman numeral, a journal page.
 */
export function pageLocator(pageLabel: string): string {
  return isPageNumber(pageLabel)
    ? m.annot_view_page({ page: pageLabel })
    : pageLabel;
}

/** What an Excerpt Image says to a reader who cannot see it. */
export function excerptImageAlt(
  annotation: Pick<AnnotationRecord, "text" | "pageLabel">,
): string {
  const { text, pageLabel } = annotation;
  if (text) return text;
  if (pageLabel === null) return m.annot_view_card_image_alt_no_page();
  return isPageNumber(pageLabel)
    ? m.annot_view_card_image_alt({ page: pageLabel })
    : m.annot_view_card_image_alt_label({ label: pageLabel });
}

/**
 * Zotero stores the excerpt as text carrying its reader's inline rich-text tags
 * (`i`/`b`/`sub`/`sup`), so it goes through Obsidian's sanitizer rather than
 * rendering as a plain string — formulas and emphasis survive, and untrusted DB
 * HTML can never inject markup.
 */
export function ExcerptText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useSanitizedHtml<HTMLParagraphElement>(text);
  return <p ref={ref} className={cn("zt:select-text", className)} />;
}

/**
 * The Excerpt Image a display demand holds, painted from an object URL this
 * picture owns and revokes. While nothing paints it says the image is loading
 * or unavailable; bytes that pass the format check yet fail to decode paint
 * unavailable too, until another image replaces them.
 *
 * @param identity the Annotation and source across pixel changes, so a
 *   replacement keeps painting the previous image of the same Annotation.
 */
export function ExcerptPicture({
  demand,
  identity,
  alt,
  className,
}: {
  demand: ExcerptDisplayDemand;
  identity: string;
  alt: string;
  className?: string;
}) {
  const display = useSyncExternalStore(demand.subscribe, demand.snapshot);
  const owned = useRef<ExcerptImageOwnership | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  /** The image that could not be decoded, which paints unavailable until another replaces it. */
  const [undecodable, setUndecodable] = useState<ExcerptImage | null>(null);
  useEffect(() => {
    const next = excerptImageOwnership({
      held: owned.current,
      display,
      identity,
      create: (image) =>
        URL.createObjectURL(
          new Blob([new Uint8Array(image.bytes)], {
            type: image.format.mimeType,
          }),
        ),
    });
    owned.current = next.owned;
    for (const stale of next.release) URL.revokeObjectURL(stale);
    setUrl(next.owned?.url ?? null);
  }, [display, identity]);
  useEffect(
    () => () => {
      const last = owned.current;
      owned.current = null;
      if (last) URL.revokeObjectURL(last.url);
    },
    [],
  );
  if (url === null && display.status === "reading")
    return <span aria-busy="true">{m.annot_view_image_loading()}</span>;
  if (url === null || undecodable === display.image)
    return <span>{m.annot_view_image_unavailable()}</span>;
  return (
    <img
      className={className}
      src={url}
      onError={() => {
        setUndecodable(display.image);
      }}
      alt={alt}
    />
  );
}
