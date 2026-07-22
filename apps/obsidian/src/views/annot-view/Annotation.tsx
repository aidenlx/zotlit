import { useContext } from "react";

import {
  annotationTypeToName,
  type AnnotationType,
  type AnnotViewItem,
} from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import { activatable, cn, tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { AnnotActionsContext } from "./actions";
import { useAnnotStore, useToggleSelectedTagID } from "./store";
import { tagChipVariants } from "./tag-chip";

const TYPE_ICON: Record<string, string> = {
  highlight: "align-left",
  underline: "underline",
  image: "frame",
  ink: "pen-line",
  text: "type",
  note: "sticky-note",
};

function typeIcon(type: AnnotationType): string {
  return TYPE_ICON[annotationTypeToName(type)] ?? "file-question";
}

function typeLabel(type: AnnotationType): string {
  const name = annotationTypeToName(type);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface AnnotationProps {
  annot: AnnotViewItem;
  collapsed: boolean;
}

export function Annotation({ annot, collapsed }: AnnotationProps) {
  const actions = useContext(AnnotActionsContext);
  const color = annot.color ?? undefined;
  const selected = useAnnotStore(
    (s) =>
      s.followMode === "reader" &&
      (s.readerTarget?.selected.includes(annot.itemID) ?? false),
  );
  const selectedTagIDs = useAnnotStore((s) => s.selectedTagIDs);
  const toggleTag = useToggleSelectedTagID();

  return (
    <div
      className="zt-annot-card zt:group zt:mb-2 zt:flex zt:break-inside-avoid zt:flex-col zt:divide-y zt:divide-border zt:overflow-hidden zt:rounded-sm zt:border zt:border-border zt:bg-background zt:transition-colors zt:hover:border-border-hover zt:data-selected:border-primary zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:@md:mb-3"
      data-id={annot.itemID}
      data-selected={selected ? "" : undefined}
    >
      <div
        className="zt:flex zt:h-8 zt:cursor-context-menu zt:items-center zt:gap-1.5 zt:bg-card zt:px-2 zt:group-data-selected:bg-transparent"
        onContextMenu={(e) => actions.onMoreOptions(e, annot)}
      >
        <span
          className="zt:flex zt:cursor-grab zt:items-center"
          draggable
          onDragStart={(e) => actions.onDragStart(e, annot)}
          {...tooltipAttrs(typeLabel(annot.type))}
        >
          <Icon name={typeIcon(annot.type)} size={16} style={{ color }} />
        </span>
        <PageLabel
          page={annot.pageLabel}
          backlink={actions.getBacklink(annot)}
        />
        <div className="zt:flex-1" />
        <span
          role="button"
          tabIndex={0}
          className="zt:flex zt:cursor-pointer zt:items-center zt:text-muted-foreground zt:transition-colors zt:hover:text-foreground"
          onClick={(e) => actions.onMoreOptions(e, annot)}
          {...tooltipAttrs(m.annot_view_more_tooltip())}
        >
          <Icon name="more-horizontal" size={16} />
        </span>
      </div>

      <ExcerptBlock annot={annot} collapsed={collapsed} color={color} />

      {annot.comment && <Comment html={annot.comment} />}

      {annot.tags.length > 0 && (
        <div className="zt:flex zt:flex-wrap zt:gap-1 zt:px-2 zt:py-1">
          {annot.tags.map((tag) => {
            const tagSelected = selectedTagIDs.includes(tag.tagID);
            return (
              <span
                key={tag.tagID}
                className={tagChipVariants({
                  state: tagSelected ? "selected" : "resting",
                  ring: true,
                })}
                {...activatable(() => toggleTag(tag.tagID))}
                aria-pressed={tagSelected}
              >
                {tag.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Comment({ html }: { html: string }) {
  const ref = useSanitizedHtml<HTMLDivElement>(html);
  return (
    <div
      ref={ref}
      className="zt:warp-break-words zt:overflow-x-auto zt:px-2 zt:py-1 zt:whitespace-pre-wrap zt:text-muted-foreground zt:select-text"
    />
  );
}

function ExcerptBlock({
  annot,
  collapsed,
  color,
}: {
  annot: AnnotViewItem;
  collapsed: boolean;
  color: string | undefined;
}) {
  const actions = useContext(AnnotActionsContext);
  const name = annotationTypeToName(annot.type);

  if ((name === "note" || name === "text") && !annot.text) return null;

  const isImage = name === "image" || name === "ink";

  let content: React.ReactNode;
  if (isImage) {
    content = (
      <img
        className={cn(
          "zt:w-full zt:object-contain zt:object-left",
          collapsed && "zt:max-h-20",
        )}
        src={actions.getImgSrc(annot)}
        alt={annot.text ?? `Area excerpt for page ${annot.pageLabel ?? "?"}`}
      />
    );
  } else if (annot.text) {
    content = <p className="zt:select-text">{annot.text}</p>;
  } else {
    content = m.annot_view_unsupported_type({ type: name });
  }

  return (
    <div className="zt:px-2 zt:py-1">
      <blockquote
        className={cn(
          "zt:border-l-2 zt:border-l-(--zt-annot-color) zt:pl-2 zt:leading-tight",
          collapsed && !isImage && "zt:line-clamp-3",
        )}
        style={
          {
            "--zt-annot-color": color ?? "var(--interactive-accent)",
          } as React.CSSProperties
        }
      >
        {content}
      </blockquote>
    </div>
  );
}

function PageLabel({
  page,
  backlink,
}: {
  page: string | null;
  backlink?: string;
}) {
  if (!page) return null;
  const label = m.annot_view_page({ page });
  if (backlink) {
    return (
      <a
        className="external-link zt:font-medium"
        href={backlink}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {label}
      </a>
    );
  }
  return <span className="zt:font-medium">{label}</span>;
}
