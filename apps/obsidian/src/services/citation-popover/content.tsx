// The Citation Popover's body: the note text a note-class style wrote the hovered citation as, or one block per cited work with its own action row.

import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { AmbiguousCandidates } from "@/components/ambiguous-candidates";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { Inlines } from "@/services/pandoc/ast";
import { InlineContent } from "@/services/pandoc/inline-content";

import type { CitationPopoverActions } from "./actions";
import type {
  AmbiguousCitationBlock,
  CitationEntryBlock,
  CitationPopoverBlock,
  UnresolvedCitationBlock,
} from "./blocks";

export interface CitationPopoverContentProps {
  /** One block per work the hovered citation names, in the order it names them. */
  blocks: readonly CitationPopoverBlock[];
  /**
   * The note text a note-class style wrote the hovered citation as, which the
   * popover shows in place of the entries; empty for a citation the style wrote
   * inline, which shows its entries instead.
   */
  note?: Inlines;
  actions: CitationPopoverActions;
  /**
   * The citekey resolution snapshot could not answer at read time — it is
   * still resolving or a rebuild is healing it — so an unresolved block means
   * "not answered yet", never "matches no item".
   */
  pending?: boolean;
}

/**
 * What one hovered citation shows: the note text the style wrote it as, or —
 * where the style wrote it inline — every work's entry in full, in citation
 * order, each with the actions that reach that work.
 */
export function CitationPopoverContent({
  blocks,
  note,
  actions,
  pending = false,
}: CitationPopoverContentProps) {
  if (note?.length) {
    return (
      <NoteCitation
        note={note}
        blocks={blocks}
        actions={actions}
        pending={pending}
      />
    );
  }
  return <EntryStack blocks={blocks} actions={actions} pending={pending} />;
}

/**
 * The stack of the works a citation names: every work's entry in full, in
 * citation order.
 *
 * A block puts its action row after its entry, and the placement class the
 * popover stamps turns that around, so the row always sits on the side of its
 * own entry the pointer came from.
 */
function EntryStack({
  blocks,
  actions,
  pending,
}: {
  blocks: readonly CitationPopoverBlock[];
  actions: CitationPopoverActions;
  pending: boolean;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <div
          // Two occurrences of one citekey are one work, so the stack has no
          // two blocks of the same key; the index keeps a fallback identity for
          // a citation that writes one twice all the same.
          key={`${block.citekey}-${index}`}
          className={blockClass}
          data-citation-popover-block={block.citekey}
        >
          {block.kind === "entry" ? (
            <>
              <Entry block={block} />
              <EntryActions block={block} actions={actions} />
            </>
          ) : (
            <Broken block={block} pending={pending} />
          )}
        </div>
      ))}
    </>
  );
}

/**
 * What a note-class style wrote the hovered citation as: the note text itself —
 * subsequent forms and note-level locators included — and one action row per
 * work the citation names, labeled with the Entry Serial that work's slot of the
 * hovered inline run showed.
 *
 * The entries stay out: the note text is what the style has to say about these
 * works here, and the References Sidebar holds their entries in full. The rows
 * follow the note text as one block, so the placement flip puts them on the side
 * the pointer came from, and they keep citation order whichever side that is.
 */
function NoteCitation({
  note,
  blocks,
  actions,
  pending,
}: {
  note: Inlines;
  blocks: readonly CitationPopoverBlock[];
  actions: CitationPopoverActions;
  pending: boolean;
}) {
  return (
    <div className={blockClass} data-citation-popover-note>
      <div className={cn(entryTextClass, "zt:text-foreground zt:select-text")}>
        <InlineContent nodes={note} />
      </div>
      <div className="zt:flex zt:flex-col zt:gap-1">
        {blocks.map((block, index) => (
          <div
            key={`${block.citekey}-${index}`}
            className="zt:grid zt:grid-cols-[max-content_minmax(0,1fr)] zt:items-center zt:gap-x-2"
            data-citation-popover-block={block.citekey}
          >
            {/* The serial this work's slot of the inline run showed, carrying
                the same public class, so a theme styles the label and the run
                it mirrors as one. A work the bibliography rendered no entry
                for reads ⚠ in both places. */}
            <span className={cn(gutterClass, themeHook.entrySerial)}>
              {serialLabel(block, pending)}
            </span>
            {block.kind === "entry" ? (
              <EntryActions block={block} actions={actions} />
            ) : (
              <Broken block={block} pending={pending} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A citekey no entry stands for, explained in that work's place: one reaching
 * no Zotero Item at all, or an Ambiguous Citation Key, which names the Items it
 * matches so the reader can tell them apart in Zotero.
 *
 * While the resolution snapshot is `pending`, an unresolved citekey has not
 * been answered yet, so the block reads as a lookup in progress rather than a
 * verdict. An ambiguous block always carries snapshot data, so it stands as-is.
 */
function Broken({
  block,
  pending,
}: {
  block: UnresolvedCitationBlock | AmbiguousCitationBlock;
  pending: boolean;
}) {
  if (block.kind === "unresolved") {
    if (pending) {
      return (
        <div className={cn(entryTextClass, "zt:text-muted-foreground")}>
          {m.references_citekey_pending({ citekey: block.citekey })}
        </div>
      );
    }
    return (
      <div className={cn(entryTextClass, "zt:text-destructive")}>
        {m.references_citekey_unresolved({ citekey: block.citekey })}
      </div>
    );
  }
  return (
    <div className="zt:flex zt:flex-col zt:gap-1">
      <div className={cn(entryTextClass, "zt:text-destructive")}>
        {m.references_citekey_ambiguous({ citekey: block.citekey })}
      </div>
      <AmbiguousCandidates
        candidates={block.candidates}
        textClass={entryTextClass}
      />
    </div>
  );
}

/** The digit standing for this work in the run the hovered citation shows. */
function serialLabel(block: CitationPopoverBlock, pending: boolean): ReactNode {
  const serial = block.kind === "entry" ? block.serial : undefined;
  // A lookup still in progress has no verdict to warn about.
  return (
    serial ?? (pending && block.kind === "unresolved" ? PENDING : NO_ENTRY)
  );
}

const blockClass =
  "zt-citation-popover-block zt:flex zt:flex-col zt:gap-1 zt:border-t zt:border-border zt:px-3 zt:py-2 zt:first:border-t-0";

const entryTextClass =
  "zt:font-content zt:text-sm zt:leading-snug zt:break-words";

/** The References Sidebar's own gutter column, which every marker stands in. */
const gutterClass =
  "zt:min-w-5 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums";

/** The slot of a cited work the bibliography rendered no entry for. */
const NO_ENTRY = "⚠";

/** The slot of a work whose citekey lookup has not answered yet. */
const PENDING = "…";

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
      {gutter !== null && <span className={gutterClass}>{gutter}</span>}
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
