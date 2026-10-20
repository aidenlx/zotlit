// The annotation popover's body: what one Durable Annotation Link names, as
// the Annotation repository holds it now.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import { isPageNumber } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { ExcerptDisplayDemand } from "@/services/excerpt-image/display";
import type { CommentRenderer } from "@/views/annot-view/comment-render";
import { excerptImageOwnership } from "@/views/annot-view/excerpt-image-state";
import type { ExcerptImageOwnership } from "@/views/annot-view/excerpt-image-state";

export type AnnotationPopoverContentProps =
  | { kind: "unavailable" }
  | {
      kind: "annotation";
      annotation: AnnotationRecord;
      renderComment: CommentRenderer;
      /** The live Excerpt Image of an image or ink Annotation. */
      excerpt: ExcerptDisplayDemand | null;
    };

const blockClass = "zt:flex zt:flex-col zt:gap-2 zt:px-3 zt:py-2";

/**
 * One Annotation: its page label and colour, the quoted text, the Excerpt
 * Image of an image or ink Annotation, and the comment — or a short note that
 * the link names an Annotation that is gone.
 */
export function AnnotationPopoverContent(props: AnnotationPopoverContentProps) {
  if (props.kind === "unavailable") {
    return (
      <div className={cn(blockClass, "zt:text-muted-foreground")} role="status">
        {m.annotation_popover_unavailable()}
      </div>
    );
  }
  const { annotation, renderComment, excerpt } = props;
  const { color, pageLabel, text, comment } = annotation;
  return (
    <div
      className={cn(
        blockClass,
        "zt:border-l-4",
        color ? "zt:border-(--zt-annot-color)" : "zt:border-border",
      )}
      // Zotero stores the colour, so it rides in a property the utilities read.
      style={color ? ({ "--zt-annot-color": color } as CSSProperties) : {}}
      data-annotation-key={annotation.key}
    >
      {pageLabel !== null && (
        // The locator the Annotation View's card wears, on the same fill.
        <span
          className={cn(
            "zt:self-start zt:rounded-sm zt:px-1 zt:font-mono zt:text-xs zt:font-medium zt:tracking-tight zt:tabular-nums",
            color
              ? "zt:bg-(--zt-annot-color)/22 zt:text-foreground"
              : "zt:text-muted-foreground",
          )}
        >
          {isPageNumber(pageLabel)
            ? m.annot_view_page({ page: pageLabel })
            : pageLabel}
        </span>
      )}
      {excerpt && (
        <ExcerptPicture
          demand={excerpt}
          identity={annotation.key}
          alt={text ?? m.annot_view_card_image_alt_no_page()}
        />
      )}
      {text && (
        <blockquote className="zt:m-0 zt:select-text">{text}</blockquote>
      )}
      {comment && <Comment html={comment} render={renderComment} />}
    </div>
  );
}

function Comment({ html, render }: { html: string; render: CommentRenderer }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return render(ref.current, html);
  }, [html, render]);
  return <div ref={ref} className="zt:text-muted-foreground zt:select-text" />;
}

/**
 * The Excerpt Image the shared display holds for the Annotation, painted from
 * an object URL this picture owns and revokes.
 */
function ExcerptPicture({
  demand,
  identity,
  alt,
}: {
  demand: ExcerptDisplayDemand;
  identity: string;
  alt: string;
}) {
  const display = useSyncExternalStore(demand.subscribe, demand.snapshot);
  const owned = useRef<ExcerptImageOwnership | null>(null);
  const [url, setUrl] = useState<string | null>(null);
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
  if (url === null) {
    return display.status === "reading" ? (
      <span aria-busy="true" className="zt:text-muted-foreground">
        {m.annot_view_image_loading()}
      </span>
    ) : (
      <span className="zt:text-muted-foreground">
        {m.annot_view_image_unavailable()}
      </span>
    );
  }
  return (
    <img
      className="zt:max-h-60 zt:max-w-full zt:self-start zt:ring-1 zt:ring-foreground/10 zt:ring-inset"
      src={url}
      alt={alt}
    />
  );
}
