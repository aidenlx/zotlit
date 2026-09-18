import { useCallback, useContext, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import { themeHook } from "@/lib/theme-hooks";
import {
  activatable,
  claimClick,
  clickClaimed,
  cn,
  tooltipAttrs,
} from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { AnnotActionsContext } from "./actions";
import { conflictPanel } from "./card-conflict";
import { cardControls, commentIcon } from "./card-controls";
import type { CardControl, CardControls } from "./card-controls";
import {
  useAnnotStore,
  useMutation,
  useSetEditingComment,
  useToggleSelectedTag,
} from "./store";
import { tagChipVariants } from "./tag-chip";

const TYPE_ICON: Record<string, string> = {
  highlight: "align-left",
  underline: "underline",
  image: "frame",
  ink: "pen-line",
  text: "type",
  note: "sticky-note",
};

function typeIcon(type: ResolvedAnnotationTypeName): string {
  return TYPE_ICON[type] ?? "file-question";
}

/**
 * What a `clickable-icon` in a card shows for hover and focus. Obsidian paints
 * both across the control's whole box, and in a 24px header that box is the
 * row — the fill reaches the row's edges and the ring reaches the next control.
 * These draw the same two marks on a pseudo-element inset inside the box, so
 * the control keeps its full 28x24 pointer target while the mark it shows fits
 * the row. `isolate` holds the mark above the control's own background and
 * under its glyph. `style.css` takes Obsidian's originals back.
 */
const CARD_CONTROL_MARK =
  "zt:relative zt:isolate zt:before:absolute zt:before:inset-x-px zt:before:inset-y-0.5 zt:before:-z-10 zt:before:rounded-sm zt:before:content-[''] zt:hover:before:bg-muted zt:focus-visible:before:ring-2 zt:focus-visible:before:ring-border-focus";

interface AnnotationProps {
  annot: AnnotationRecord;
  collapsed: boolean;
}

/**
 * Each control state is a fresh object, and the store is read through
 * `useSyncExternalStore`, which compares snapshots by identity — so it is built
 * from the slices it depends on and held while those are unchanged.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1146
 */
function useCardControls(annot: AnnotationRecord): CardControls {
  const capability = useAnnotStore((s) => s.capability);
  const mutation = useMutation(annot.key);
  const hasComment = annot.comment !== null;
  return useMemo(
    () =>
      cardControls({
        capability,
        mutation,
        hasComment,
        // A card's tooltip is read at the moment it is drawn; the ticking
        // countdown belongs to the toolbar affordance, not to every card.
        now: Temporal.Now.instant(),
      }),
    [capability, mutation, hasComment],
  );
}

export function Annotation({ annot, collapsed }: AnnotationProps) {
  const actions = useContext(AnnotActionsContext);
  const selected = useAnnotStore((s) =>
    s.selectedAnnotationKeys.includes(annot.key),
  );
  const dragTarget = useAnnotStore((s) => s.dragTarget);
  const editing = useAnnotStore((s) => s.editingCommentKey === annot.key);
  const controls = useCardControls(annot);

  return (
    <div
      className="zt-annot-card zt:group zt:mb-2 zt:flex zt:break-inside-avoid zt:flex-col zt:divide-y zt:divide-border zt:overflow-hidden zt:rounded-sm zt:border zt:border-s-3 zt:border-border zt:bg-background zt:hover:border-border-hover zt:data-annot-color:border-s-(--zt-annot-color) zt:data-selected:border-e-primary zt:data-selected:border-t-primary zt:data-selected:border-b-primary zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:motion-safe:transition-colors zt:@md:mb-3"
      // The Annotation's colour, as the colour itself along the card's leading
      // edge — the one place the card states it. A glyph cannot hold it:
      // Zotero's palette carries 1.3:1 to 2.1:1 against this header, so a
      // tinted icon stops naming its own shape.
      //
      // Zotero's hex is data, so it rides in a custom property and
      // `data-annot-color` says it is there; the declaration that reads them
      // stays a utility. An Annotation with no colour keeps the border token,
      // so every card in a column aligns on the same content edge. Selection
      // names the three sides it owns rather than all four: `border-primary`
      // outranks this variant, and a selected card would lose its colour.
      style={{ "--zt-annot-color": annot.color } as React.CSSProperties}
      data-annot-color={annot.color ?? undefined}
      data-zotero-annotation-key={annot.key}
      data-selected={selected ? "" : undefined}
      onClick={(e) => {
        // A control inside the card already answered this click; the card's
        // selection is not it.
        if (clickClaimed(e)) return;
        actions.onSelectAnnotation(annot);
      }}
    >
      {/* One 24px box metric for every member of the row, so the glyphs, the
          page link and the verbs sit on one line rather than three. `px-2`
          is the body's own text edge; each end control pulls back by the
          `clickable-icon` padding it carries, which lands its glyph on that
          edge instead of 6px inside it. */}
      <div className="zt:flex zt:min-h-6 zt:items-center zt:bg-card zt:px-2 zt:group-data-selected:bg-transparent">
        {/* The card's own click takes the selection, and a pointer is the only
            thing that can press a card. This is the same gesture as a control:
            the keyboard reaches it, and `aria-pressed` says what it left.
            Dragging rides on the same element where a note is open to take it. */}
        <IconButton
          icon={typeIcon(annot.type)}
          aria-pressed={selected}
          // `.clickable-icon` reads `cursor: var(--cursor)` unlayered, so a
          // `cursor-*` utility cannot reach it. Feed that variable instead.
          className={cn(
            CARD_CONTROL_MARK,
            "zt:-ms-1.5 zt:data-drag-ready:[--cursor:grab]",
          )}
          data-drag-ready={dragTarget === "ready" ? "" : undefined}
          draggable={dragTarget === "ready"}
          onDragStart={(e) => actions.onDragStart(e, annot)}
          onClick={(e) => {
            claimClick(e);
            actions.onSelectAnnotation(annot);
          }}
          {...tooltipAttrs(m.annot_view_card_show_in_reader())}
        />
        <PageLabel
          page={annot.pageLabel}
          backlink={actions.getBacklink(annot)}
        />
        <CardActionBar annot={annot} controls={controls} editing={editing} />
      </div>

      <ConflictSlot annot={annot} />

      <ExcerptBlock annot={annot} collapsed={collapsed} />

      <CommentSlot annot={annot} editing={editing} control={controls.comment} />

      <TagRow annot={annot} />
    </div>
  );
}

/**
 * Zotero's copy of this Annotation moved under the user's write, so the card
 * puts the fresh Zotero value beside what the user asked for and offers the
 * two verbs that end it. Nothing was drawn ahead of Zotero, so the card around
 * this panel already shows what Zotero holds.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1151
 */
function ConflictSlot({ annot }: { annot: AnnotationRecord }) {
  const actions = useContext(AnnotActionsContext);
  const mutation = useMutation(annot.key);
  const panel = useMemo(
    () =>
      mutation.kind === "conflict" ? conflictPanel(mutation.conflict) : null,
    [mutation],
  );
  if (!panel) return null;

  return (
    <div
      className={cn(
        themeHook.annotConflict,
        "zt:flex zt:flex-col zt:gap-1 zt:bg-secondary zt:px-2 zt:py-1.5",
      )}
    >
      <div className="zt:flex zt:items-center zt:gap-1 zt:font-medium">
        <Icon name="alert-triangle" size={14} />
        {panel.title}
      </div>
      {panel.prompt !== null && (
        <div className="zt:text-muted-foreground">{panel.prompt}</div>
      )}
      {panel.values.map((value) => (
        <div key={value.label} className="zt:flex zt:gap-1">
          <span className="zt:shrink-0 zt:text-muted-foreground">
            {value.label}
          </span>
          <span className="zt:min-w-0 zt:break-words">{value.value}</span>
        </div>
      ))}
      <div className="zt:flex zt:gap-2">
        {panel.actions.map((action) => (
          <span
            key={action.kind}
            className="zt:cursor-link zt:rounded-sm zt:text-link zt:underline zt:underline-offset-2 zt:hover:text-link-hover zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus"
            // The card's own click takes the selection; a verb is not that, and
            // `activatable` stops the click before the card sees it.
            {...activatable(() =>
              action.kind === "discard"
                ? actions.onDiscardConflict(annot)
                : actions.onApplyAgain(annot),
            )}
          >
            {action.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The card's verbs, as the same `clickable-icon` row the Mark Popup draws over
 * a selected mark — colour, comment and delete are the same three writes
 * reached from another surface, so they wear the same control.
 *
 * The three editing verbs rest dimmed and come up to full on hover, while
 * focus is inside the card so the keyboard reaches them, and while the card is
 * selected. The overflow control never dims: it is the only route to copying,
 * revealing and deleting.
 *
 * @see apps/obsidian/src/services/pdf-annotation-editor/mark-popup.ts
 */
function CardActionBar({
  annot,
  controls,
  editing,
}: {
  annot: AnnotationRecord;
  controls: CardControls;
  editing: boolean;
}) {
  const actions = useContext(AnnotActionsContext);
  const setEditing = useSetEditingComment();
  const hasComment = annot.comment !== null;

  return (
    // The card's own click takes the selection; a verb is not that. The row
    // claims the click once, rather than each control claiming it itself.
    <div
      className="zt:-me-1.5 zt:ml-auto zt:flex zt:shrink-0 zt:items-center"
      onClick={claimClick}
    >
      {/* 70% is the floor the resting state can dim to and still read: at it
          the icon carries 3.26:1 against the header, and WCAG 1.4.11 asks 3:1
          of a control. 40% measured 1.84:1. */}
      <div className="zt:flex zt:items-center zt:opacity-70 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-data-selected:opacity-100 zt:motion-safe:transition-opacity">
        <IconButton
          icon="palette"
          className={CARD_CONTROL_MARK}
          disabled={controls.color.disabled}
          onClick={(evt) => actions.onColorMenu(evt, annot)}
          {...tooltipAttrs(controls.color.tooltip)}
        />
        <IconButton
          icon={commentIcon(hasComment)}
          className={CARD_CONTROL_MARK}
          active={editing}
          disabled={controls.comment.disabled}
          onClick={() => setEditing(editing ? null : annot.key)}
          {...tooltipAttrs(controls.comment.tooltip)}
        />
      </div>
      <IconButton
        icon="more-horizontal"
        className={CARD_CONTROL_MARK}
        onClick={(evt) => actions.onMoreOptions(evt, annot)}
        {...tooltipAttrs(m.annot_view_more_tooltip())}
      />
    </div>
  );
}

/**
 * The Annotation's own tags, in the card rather than behind a control: a
 * researcher scanning a column reads what an Annotation is filed under without
 * opening anything. They wear the same native-tag chip the filter bar and its
 * drawer draw, dense, because the card is the densest of the three surfaces.
 *
 * A chip is a filter toggle, so a tag seen on one card is the gesture that
 * narrows the list to it, and a chip already in the filter rests in the accent.
 */
function TagRow({ annot }: { annot: AnnotationRecord }) {
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  const toggleTag = useToggleSelectedTag();
  if (annot.tags.length === 0) return null;

  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1 zt:px-2 zt:py-1">
      {annot.tags.map((tag) => {
        const selected = selectedTags.includes(tag);
        return (
          <span
            key={tag}
            aria-pressed={selected}
            className={tagChipVariants({
              state: selected ? "selected" : "resting",
              density: "dense",
              truncate: true,
            })}
            // The card's own click takes the selection; filtering is not that.
            {...activatable(() => toggleTag(tag))}
            {...tooltipAttrs(m.annot_view_card_tag_tooltip({ name: tag }))}
          >
            <span className="zt:block zt:truncate">{tag}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The comment, rendered or being edited. The slot is the same either way, so
 * the card's height answers to the comment text and to nothing else.
 */
function CommentSlot({
  annot,
  editing,
  control,
}: {
  annot: AnnotationRecord;
  editing: boolean;
  control: CardControl;
}) {
  if (editing) return <CommentEditor annot={annot} />;
  if (annot.comment === null) return null;
  return <Comment annot={annot} editable={!control.disabled} />;
}

/**
 * `markdown-rendered` is what buys the theme's own prose styling: Obsidian
 * declares those rules unlayered, so they outrank the scoped Tailwind preflight.
 * `zt-annot-comment` is the card-scoped hook the view stylesheet compacts them
 * through.
 */
function Comment({
  annot,
  editable,
}: {
  annot: AnnotationRecord;
  editable: boolean;
}) {
  const actions = useContext(AnnotActionsContext);
  const setEditing = useSetEditingComment();
  const html = annot.comment ?? "";
  const ref = useCallback(
    (el: HTMLDivElement) => actions.renderComment(el, html),
    [actions, html],
  );
  return (
    <div
      ref={ref}
      className={cn(
        "markdown-rendered zt-annot-comment zt:overflow-x-auto zt:px-2 zt:py-1 zt:break-words zt:text-muted-foreground zt:select-text",
        editable && "zt:cursor-text",
      )}
      onClick={(e) => {
        // A link keeps its own click, and a click that ends a text selection is
        // the user copying rather than asking to edit.
        if (!editable) return;
        const target = e.target as Node | null;
        if (target?.instanceOf(HTMLElement) && target.closest("a")) return;
        if (e.currentTarget.win.getSelection()?.isCollapsed === false) return;
        // Opening the editor is a verb; the card's own click is not that.
        e.stopPropagation();
        setEditing(annot.key);
      }}
    />
  );
}

/**
 * The comment editor, in the slot the rendered comment stood in, with the
 * caret at the end of what is already there.
 *
 * `Escape` leaves the text as Zotero holds it; a blur and `Ctrl/Command+Enter`
 * both store it. Nothing is drawn ahead of Zotero: the slot goes back to the
 * rendered comment, and the new text appears when the write lands.
 */
function CommentEditor({ annot }: { annot: AnnotationRecord }) {
  const actions = useContext(AnnotActionsContext);
  const setEditing = useSetEditingComment();
  const stored = annot.comment ?? "";
  const [text, setText] = useState(stored);

  const focusEnd = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = (): void => {
    setEditing(null);
    if (text !== stored) actions.onSaveComment(annot, text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    // Placing the caret is not the card's selection.
    <div className="zt:px-2 zt:py-1" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={focusEnd}
        className="zt:w-full zt:resize-none zt:bg-transparent zt:text-xs"
        value={text}
        rows={Math.min(6, Math.max(2, text.split("\n").length + 1))}
        placeholder={m.annot_view_card_comment_placeholder()}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={save}
      />
    </div>
  );
}

/**
 * Zotero stores the excerpt as text carrying its reader's inline rich-text tags
 * (`i`/`b`/`sub`/`sup`), so it goes through Obsidian's sanitizer rather than
 * rendering as a plain string — formulas and emphasis survive, and untrusted DB
 * HTML can never inject markup.
 */
function ExcerptText({ text }: { text: string }) {
  const ref = useSanitizedHtml<HTMLParagraphElement>(text);
  return <p ref={ref} className="zt:select-text" />;
}

function ExcerptBlock({
  annot,
  collapsed,
}: {
  annot: AnnotationRecord;
  collapsed: boolean;
}) {
  const actions = useContext(AnnotActionsContext);
  const name = annot.type;

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
        alt={
          annot.text ??
          (annot.pageLabel === null
            ? m.annot_view_card_image_alt_no_page()
            : m.annot_view_card_image_alt({ page: annot.pageLabel }))
        }
      />
    );
  } else if (annot.text) {
    content = <ExcerptText text={annot.text} />;
  } else {
    content = m.annot_view_unsupported_type({ type: name });
  }

  return (
    <div className="zt:px-2 zt:py-1">
      <blockquote
        className={cn(
          "zt:leading-tight",
          collapsed && !isImage && "zt:line-clamp-3",
        )}
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
      // `external-link` keeps the theme's own external-link colour and cursor;
      // `zt-annot-page-link` is where the view stylesheet takes back the boxed
      // glyph Obsidian paints with it, so the arrow beside the label is the same
      // Lucide stroke as every other icon on this row.
      <a
        className="external-link zt-annot-page-link zt:flex zt:min-w-0 zt:items-center zt:gap-px"
        href={backlink}
        // Opening the page in Zotero is its own verb, not the card's selection.
        onClick={(e) => e.stopPropagation()}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        <span className="zt:truncate">{label}</span>
        {/* 1.5px at 12px carries the optical weight the row's 16px glyphs
            carry at 2px, so the arrow reads as the same icon set beside 400
            text rather than a heavier mark. */}
        <Icon
          name="arrow-up-right"
          size={12}
          strokeWidth={1.5}
          className="zt:shrink-0"
        />
      </a>
    );
  }
  return <span className="zt:min-w-0 zt:truncate">{label}</span>;
}
