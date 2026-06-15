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
      className="zt-annot-card zt:mb-2 zt:flex zt:break-inside-avoid zt:flex-col zt:divide-y zt:divide-border zt:overflow-hidden zt:rounded-sm zt:border zt:border-border zt:bg-background zt:transition-colors zt:@md:mb-3"
      data-id={annot.itemID}
    >
      <div
        className="zt:flex zt:cursor-context-menu zt:items-center zt:gap-1 zt:bg-card zt:px-2"
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
        <div className="zt:flex zt:items-center zt:gap-1 zt:opacity-0 zt:transition-opacity zt:[--icon-size:16px] zt:hover:opacity-100">
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
        <div className="zt:flex-1" />
        <PageLabel
          page={annot.pageLabel}
          backlink={actions.getBacklink(annot)}
        />
      </div>

      <div className="zt:px-2 zt:py-1">
        <blockquote
          className={cn(
            "zt:border-l-2 zt:pl-2 zt:leading-tight",
            collapsed && "zt:line-clamp-3",
          )}
          style={{ borderLeftColor: color ?? "var(--interactive-accent)" }}
        >
          <Excerpt annot={annot} collapsed={collapsed} />
        </blockquote>
      </div>

      {annot.comment && (
        <div className="zt:overflow-x-auto zt:px-2 zt:py-1 zt:break-words zt:whitespace-pre-wrap zt:text-muted-foreground zt:select-text">
          {annot.comment}
        </div>
      )}

      {tags.length > 0 && (
        <div className="zt:flex zt:flex-wrap zt:gap-1 zt:px-2 zt:py-1">
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
    return <p className="zt:select-text">{annot.text}</p>;
  }
  if (name === "image") {
    return (
      <img
        className={cn(
          "zt:w-full",
          collapsed
            ? "zt:max-h-20 zt:object-cover zt:object-left-top"
            : "zt:object-scale-down",
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
        className="external-link zt:text-xs"
        href={backlink}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {label}
      </a>
    );
  }
  return <span className="zt:text-xs">{label}</span>;
}
