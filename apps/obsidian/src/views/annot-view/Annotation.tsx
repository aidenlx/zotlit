import { useContext } from "react";

import { annotationTypeToName, type AnnotationType } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { cn, tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { AnnotActionsContext } from "./actions";
import { type AnnotItem, type TagItem } from "./store";

const TYPE_ICON: Record<string, string> = {
  highlight: "align-left",
  underline: "underline",
  image: "frame",
  text: "text-select",
};

function typeIcon(type: AnnotationType): string {
  return TYPE_ICON[annotationTypeToName(type)] ?? "file-question";
}

function typeLabel(type: AnnotationType): string {
  const name = annotationTypeToName(type);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface AnnotationProps {
  annot: AnnotItem;
  tags: TagItem[];
  collapsed: boolean;
}

export function Annotation({ annot, tags, collapsed }: AnnotationProps) {
  const actions = useContext(AnnotActionsContext);
  const color = annot.color ?? undefined;

  return (
    <div
      className="zt-annot-card mb-2 flex break-inside-avoid flex-col divide-y divide-border overflow-hidden rounded-sm border border-border bg-background transition-colors @md:mb-3"
      data-id={annot.itemID}
    >
      <div
        className="flex cursor-context-menu items-center gap-1 bg-card px-2"
        onContextMenu={(e) => actions.onMoreOptions(e, annot)}
      >
        <span
          className="flex cursor-grab items-center"
          draggable
          onDragStart={(e) => actions.onDragStart(e, annot)}
          {...tooltipAttrs(typeLabel(annot.type))}
        >
          <Icon name={typeIcon(annot.type)} size={16} style={{ color }} />
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity [--icon-size:16px] hover:opacity-100">
          <IconButton
            icon="info"
            onClick={() => actions.onShowDetails("annot", annot.itemID)}
            {...tooltipAttrs(m.annot_view_details_tooltip())}
          />
          <IconButton
            icon="more-vertical"
            onClick={(e) => actions.onMoreOptions(e, annot)}
            {...tooltipAttrs(m.annot_view_more_tooltip())}
          />
        </div>
        <div className="flex-1" />
        <PageLabel
          page={annot.pageLabel}
          backlink={actions.getBacklink(annot)}
        />
      </div>

      <div className="px-2 py-1">
        <blockquote
          className={cn(
            "border-l-2 pl-2 leading-tight",
            collapsed && "line-clamp-3",
          )}
          style={{ borderLeftColor: color ?? "var(--interactive-accent)" }}
        >
          <Excerpt annot={annot} collapsed={collapsed} />
        </blockquote>
      </div>

      {annot.comment && (
        <div className="overflow-x-auto px-2 py-1 break-words whitespace-pre-wrap text-muted-foreground select-text">
          {annot.comment}
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {tags.map((tag) => (
            <a key={tag.tagID} className="tag">
              {tag.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Excerpt({
  annot,
  collapsed,
}: {
  annot: AnnotItem;
  collapsed: boolean;
}) {
  const actions = useContext(AnnotActionsContext);
  const name = annotationTypeToName(annot.type);

  if (name === "highlight" || name === "underline" || name === "text") {
    return <p className="select-text">{annot.text}</p>;
  }
  if (name === "image") {
    return (
      <img
        className={cn(
          "w-full",
          collapsed
            ? "max-h-20 object-cover object-left-top"
            : "object-scale-down",
        )}
        src={actions.getImgSrc(annot)}
        alt={annot.text ?? `Area excerpt for page ${annot.pageLabel ?? "?"}`}
      />
    );
  }
  return <>{m.annot_view_unsupported_type({ type: name })}</>;
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
        className="external-link text-xs"
        href={backlink}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {label}
      </a>
    );
  }
  return <span className="text-xs">{label}</span>;
}
