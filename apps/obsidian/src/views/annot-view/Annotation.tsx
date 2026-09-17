import { useCallback, useContext, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import { themeHook } from "@/lib/theme-hooks";
import { activatable, cn, tooltipAttrs } from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { AnnotActionsContext } from "./actions";
import { conflictPanel } from "./card-conflict";
import { cardControls, commentIcon } from "./card-controls";
import type { CardControl, CardControls } from "./card-controls";
import { useAnnotStore, useMutation, useSetEditingComment } from "./store";

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

function typeLabel(type: ResolvedAnnotationTypeName): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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
  const color = annot.color ?? undefined;
  const selected = useAnnotStore((s) =>
    s.selectedAnnotationKeys.includes(annot.key),
  );
  const dragTarget = useAnnotStore((s) => s.dragTarget);
  const editing = useAnnotStore((s) => s.editingCommentKey === annot.key);
  const controls = useCardControls(annot);
  const dragTooltip =
    dragTarget === "ready"
      ? typeLabel(annot.type)
      : dragTarget === "preparing"
        ? m.annot_view_drag_preparing_tooltip()
        : m.annot_view_drag_no_note_tooltip();

  return (
    <div
      className="zt-annot-card zt:group zt:mb-2 zt:flex zt:break-inside-avoid zt:flex-col zt:divide-y zt:divide-border zt:overflow-hidden zt:rounded-sm zt:border zt:border-border zt:bg-background zt:transition-colors zt:hover:border-border-hover zt:data-selected:border-primary zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:@md:mb-3"
      data-zotero-annotation-key={annot.key}
      data-selected={selected ? "" : undefined}
      onClick={() => actions.onSelectAnnotation(annot)}
    >
      <div
        className="zt:flex zt:h-8 zt:cursor-context-menu zt:items-center zt:gap-1.5 zt:bg-card zt:px-2 zt:group-data-selected:bg-transparent"
        onContextMenu={(e) => actions.onCardContextMenu(e, annot)}
      >
        <span
          className={cn(
            "zt:flex zt:items-center",
            dragTarget === "ready"
              ? "zt:cursor-grab"
              : "zt:cursor-not-allowed zt:opacity-40",
          )}
          draggable={dragTarget === "ready"}
          aria-disabled={dragTarget !== "ready"}
          onDragStart={(e) => actions.onDragStart(e, annot)}
          {...tooltipAttrs(dragTooltip)}
        >
          <Icon name={typeIcon(annot.type)} size={16} style={{ color }} />
        </span>
        <PageLabel
          page={annot.pageLabel}
          backlink={actions.getBacklink(annot)}
        />
        <div className="zt:flex-1" />
        <CardActionBar annot={annot} controls={controls} editing={editing} />
      </div>

      <ConflictSlot annot={annot} />

      <ExcerptBlock annot={annot} collapsed={collapsed} color={color} />

      <CommentSlot annot={annot} editing={editing} control={controls.comment} />
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
          <button
            key={action.kind}
            className="zt:underline"
            onClick={(e) => {
              // The card's own click takes the selection; a verb is not that.
              e.stopPropagation();
              if (action.kind === "discard") actions.onDiscardConflict(annot);
              else actions.onApplyAgain(annot);
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The editing verbs, layered into the header row the card already had: they
 * take no space of their own, so the card never changes size for them. They
 * appear on hover, while focus is inside the card so the keyboard reaches
 * them, and stay pinned while the card is selected.
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
    <div className="zt:flex zt:items-center zt:gap-0.5 zt:opacity-0 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-data-selected:opacity-100 zt:motion-safe:transition-opacity">
      <ColorControl annot={annot} control={controls.color} />
      <CardButton
        control={controls.comment}
        active={editing}
        onClick={() => setEditing(editing ? null : annot.key)}
      >
        <Icon name={commentIcon(hasComment)} size={16} />
      </CardButton>
      <TagMenu annot={annot} />
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
  );
}

/**
 * One header verb. A blocked one keeps its seat and carries the reason in its
 * tooltip and its accessible state rather than leaving the row.
 *
 * @see apps/obsidian/policies/tooltips.md
 */
function CardButton({
  control,
  active,
  onClick,
  children,
}: {
  control: CardControl;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "zt:flex zt:items-center zt:text-muted-foreground zt:transition-colors",
        control.disabled
          ? "zt:cursor-not-allowed zt:opacity-40"
          : "zt:cursor-pointer zt:hover:text-foreground",
        active && "zt:text-accent-foreground",
      )}
      aria-disabled={control.disabled || undefined}
      {...activatable(onClick, { disabled: control.disabled })}
      {...tooltipAttrs(control.tooltip)}
    >
      {children}
    </span>
  );
}

/** A filled dot in the Annotation's own colour, opening Zotero's eight. */
function ColorControl({
  annot,
  control,
}: {
  annot: AnnotationRecord;
  control: CardControl;
}) {
  const actions = useContext(AnnotActionsContext);

  if (control.disabled) {
    return (
      <span
        className="zt:flex zt:cursor-not-allowed zt:items-center zt:opacity-40"
        aria-disabled="true"
        {...tooltipAttrs(control.tooltip)}
      >
        <ColorDot color={annot.color} />
      </span>
    );
  }
  return (
    <button
      className="zt:flex zt:cursor-pointer zt:items-center"
      onClick={(evt) => actions.onColorMenu(evt, annot)}
      {...tooltipAttrs(control.tooltip)}
    >
      <ColorDot color={annot.color} />
    </button>
  );
}

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      className="zt:size-3 zt:shrink-0 zt:rounded-full zt:ring-1 zt:ring-border"
      style={{ backgroundColor: color ?? "var(--interactive-accent)" }}
    />
  );
}

/**
 * The Annotation's own tags, as a menu rather than a row of chips: a row grows
 * with the tag count, and the card's height answers to the comment alone.
 * Selecting one filters the list by it, which is what the chips did.
 */
function TagMenu({ annot }: { annot: AnnotationRecord }) {
  const actions = useContext(AnnotActionsContext);
  if (annot.tags.length === 0) return null;

  return (
    <button
      className="zt:flex zt:cursor-pointer zt:items-center zt:text-muted-foreground zt:transition-colors zt:hover:text-foreground"
      onClick={(evt) => actions.onTagMenu(evt, annot)}
      {...tooltipAttrs(m.annot_view_card_tags())}
    >
      <Icon name="tags" size={16} />
    </button>
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
    <div className="zt:px-2 zt:py-1">
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
  color,
}: {
  annot: AnnotationRecord;
  collapsed: boolean;
  color: string | undefined;
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
        alt={annot.text ?? `Area excerpt for page ${annot.pageLabel ?? "?"}`}
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
