// The annotation popover's body: what one Durable Annotation Link names, as
// the Annotation repository holds it now.

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { ExcerptDisplayDemand } from "@/services/excerpt-image/display";
import type { CommentRenderer } from "@/views/annot-view/comment-render";
import {
  ExcerptPicture,
  ExcerptText,
  excerptImageAlt,
  pageLocator,
} from "@/views/annot-view/excerpt-parts";

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
 * the link names an Annotation that is gone. The text, the image, and the
 * locator render as the Annotation View's card renders them.
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
          {pageLocator(pageLabel)}
        </span>
      )}
      {excerpt && (
        <ExcerptPicture
          demand={excerpt}
          identity={annotation.key}
          alt={excerptImageAlt(annotation)}
          className="zt:max-h-60 zt:max-w-full zt:self-start zt:ring-1 zt:ring-foreground/10 zt:ring-inset"
        />
      )}
      {text && <ExcerptText text={text} className="zt:m-0" />}
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
