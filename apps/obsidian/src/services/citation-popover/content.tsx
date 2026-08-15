// The Citation Popover's body: one block per cited work, each with its own action row.

import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import { InlineContent } from "@/services/pandoc/inline-content";

import type { CitationPopoverActions } from "./actions";
import type { CitationEntryBlock, CitationPopoverBlock } from "./blocks";

export interface CitationPopoverContentProps {
  /** One block per work the hovered citation names, in the order it names them. */
  blocks: readonly CitationPopoverBlock[];
  actions: CitationPopoverActions;
}

/**
 * The stack one hovered citation shows: every work's entry in full, in citation
 * order, each with the actions that reach that work.
 *
 * A block puts its action row after its entry, and the placement class the
 * popover stamps turns that around, so the row always sits on the side of its
 * own entry the pointer came from.
 */
export function CitationPopoverContent({
  blocks,
  actions,
}: CitationPopoverContentProps) {
  return (
    <>
      {blocks.map((block, index) => (
        <div
          // Two occurrences of one citekey are one work, so the stack has no
          // two blocks of the same key; the index keeps a fallback identity for
          // a citation that writes one twice all the same.
          key={`${block.citekey}-${index}`}
          className="zt-citation-popover-block zt:flex zt:flex-col zt:gap-1 zt:border-t zt:border-border zt:px-3 zt:py-2 zt:first:border-t-0"
          data-citation-popover-block={block.citekey}
        >
          {block.kind === "entry" ? (
            <>
              <Entry block={block} />
              <EntryActions block={block} actions={actions} />
            </>
          ) : (
            <div className={cn(entryTextClass, "zt:text-destructive")}>
              {m.references_citekey_unresolved({ citekey: block.citekey })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const entryTextClass =
  "zt:font-content zt:text-sm zt:leading-snug zt:break-words";

/**
 * The References Sidebar's entry presentation: the gutter beside the entry
 * text, both rendered by the shared renderer, and the text selectable so a
 * formatted entry can be copied straight out of the popover.
 */
function Entry({ block }: { block: CitationEntryBlock }) {
  const gutter = entryGutter(block);
  return (
    <div
      className={cn(
        "zt:grid zt:items-baseline zt:gap-x-2",
        gutter === null
          ? "zt:grid-cols-[minmax(0,1fr)]"
          : "zt:grid-cols-[max-content_minmax(0,1fr)]",
      )}
    >
      {gutter !== null && (
        <span className="zt:min-w-5 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums">
          {gutter}
        </span>
      )}
      <div className={cn(entryTextClass, "zt:text-foreground zt:select-text")}>
        {block.content === null ? (
          block.summary
        ) : (
          <InlineContent nodes={block.content} />
        )}
      </div>
    </div>
  );
}

/**
 * The Entry Marker the style wrote, or the Entry Serial standing for it where
 * the document's citations show serials in place of the notes the style writes.
 */
function entryGutter(block: CitationEntryBlock): ReactNode {
  if (block.marker) return <InlineContent nodes={block.marker} />;
  return block.serial ?? null;
}

/**
 * Always visible, unlike the sidebar's own hover-revealed row: a popover the
 * pointer is already inside has nothing left to reveal on.
 */
function EntryActions({
  block,
  actions,
}: {
  block: CitationEntryBlock;
  actions: CitationPopoverActions;
}) {
  return (
    <div
      className="zt:flex zt:items-center zt:gap-0.5"
      data-citation-popover-actions
    >
      <EntryAction
        icon="file-text"
        label={m.references_open_note()}
        onClick={(event) => {
          actions.onOpenNote(block, event);
          actions.onDone();
        }}
      />
      <EntryAction
        icon="external-link"
        label={m.references_open_in_zotero()}
        onClick={() => {
          actions.onOpenInZotero(block);
          actions.onDone();
        }}
      />
      {/* Dropped outright when the Item stores nothing to open, so no action
          in the row can ever be a dead one. */}
      {block.attachments.length > 0 && (
        <EntryAction
          icon="paperclip"
          label={m.references_open_attachment()}
          onClick={(event) => {
            actions.onOpenAttachment(block, event);
            actions.onDone();
          }}
        />
      )}
    </div>
  );
}

/**
 * A clickable-icon defaults to ribbon proportions, which dwarfs the entry text
 * it sits under; the sidebar's own trim of the glyph and the box keeps an
 * action reading as a footnote to that text.
 */
const compactIconButton = "zt:p-1 zt:[--icon-size:var(--icon-xs)]";

function EntryAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      // Obsidian reads middle-click off the auxiliary click; a plain click
      // never fires for it, and it is how a new pane is asked for.
      onAuxClick={(event) => {
        if (event.button === 1) onClick(event);
      }}
      className={compactIconButton}
      {...tooltipAttrs(label)}
    />
  );
}
