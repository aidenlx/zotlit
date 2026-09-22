import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { Button } from "@/components/obsidian/button";
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
import type { ExcerptImage } from "@/services/excerpt-image/format";

import { AnnotActionsContext } from "./actions";
import { conflictPanel } from "./card-conflict";
import {
  cardControls,
  commentIcon,
  commentEditorControls,
} from "./card-controls";
import type { CardControl, CardControls } from "./card-controls";
import {
  excerptImageOwnership,
  excerptImageTarget,
} from "./excerpt-image-state";
import type {
  ExcerptImageOwnership,
  ExcerptImageTarget,
} from "./excerpt-image-state";
import {
  useAnnotStore,
  useMutation,
  useOpenDrawer,
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
 * A verb the Editing Capability blocks rests dimmed, as the state it reports is
 * one the user can read about. The dim is all it takes: `aria-disabled` would
 * hide the control from assistive technology, and its press is the only route
 * to the drawer that holds the explanation.
 */
const BLOCKED_VERB_DIM = "zt:data-blocked:opacity-50";

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
  const editing = useAnnotStore((s) => s.editingCommentKey === annot.key);
  const controls = useCardControls(annot);

  return (
    <div
      className="zt-annot-card zt:group zt:flex zt:flex-col zt:gap-2 zt:overflow-hidden zt:rounded-(--bases-kanban-card-radius) zt:bg-(--bases-kanban-card-background) zt:px-3 zt:py-2 zt:text-xs zt:shadow-(--bases-kanban-card-shadow) zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:motion-safe:transition-colors"
      // The card is the surface Obsidian draws for a Bases card: its fill, its
      // radius and its hairline-and-drop shadow are read from the same theme
      // variables, so a theme that restyles Bases cards restyles these. The
      // parts inside stack on one 8px gap with no divider rule between them.
      // The card's own voice is chrome at 12px; the excerpt and the comment
      // name their sizes themselves.
      //
      // Zotero's hex is data, so it rides in a custom property and
      // `data-annot-color` says it is there; the declaration that reads them
      // stays a utility. The colour is drawn once, fused with the page chip —
      // the one mark that carries both where the Annotation is and what colour
      // it was made in.
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
      {/* One 24px box metric for every member of the row, so the glyph, the
          page label and the verbs sit on one line rather than three. Each end
          control pulls back by the `clickable-icon` padding it carries, which
          lands its glyph on the card's text edge instead of 6px inside it. */}
      <div className="zt:flex zt:min-h-6 zt:items-center zt:gap-1">
        {/* The card's own click takes the selection, and a pointer is the only
            thing that can press a card. This is the same gesture as a control:
            the keyboard reaches it, and `aria-pressed` says what it left.
            Dragging rides on the same element where a note is open to take it. */}
        <IconButton
          icon={typeIcon(annot.type)}
          aria-pressed={selected}
          // `.clickable-icon` reads `cursor: var(--cursor)` unlayered, so a
          // `cursor-*` utility cannot reach it. Feed that variable instead.
          className="zt:-ms-1.5 zt:data-drag-ready:[--cursor:grab]"
          data-drag-ready=""
          draggable
          onDragStart={(e) => actions.onDragStart(e, annot)}
          onClick={(e) => {
            claimClick(e);
            actions.onSelectAnnotation(annot);
          }}
          {...tooltipAttrs(m.annot_view_card_show_in_reader())}
        />
        <PageLabel
          page={annot.pageLabel}
          color={annot.color}
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
  const capability = useAnnotStore((state) => state.capability);
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
        "zt:-mx-3 zt:flex zt:flex-col zt:gap-1 zt:bg-secondary zt:px-3 zt:py-1.5",
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
      <div className="zt:mt-2 zt:flex zt:flex-wrap zt:gap-2">
        {panel.actions.map((action) => (
          <Button
            key={action.kind}
            disabled={
              action.kind !== "discard" && capability.kind !== "writable"
            }
            onClick={(event) => {
              event.stopPropagation();
              if (action.kind === "discard") actions.onDiscardConflict(annot);
              else actions.onApplyAgain(annot);
            }}
          >
            {action.label}
          </Button>
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
  const openDrawer = useOpenDrawer();
  const hasComment = annot.comment !== null;

  /**
   * What one verb's press does. A verb the Editing Capability blocks keeps its
   * press and spends it on the drawer instead of on the write: the reason lives
   * there, and a control that refused the press could never reach it.
   */
  const press =
    (control: CardControl, act: (evt: MouseEvent<HTMLElement>) => void) =>
    (evt: MouseEvent<HTMLElement>): void => {
      if (control.blocked) {
        openDrawer(evt.currentTarget);
        return;
      }
      act(evt);
    };

  return (
    // The card's own click takes the selection; a verb is not that. The row
    // claims the click once, rather than each control claiming it itself.
    <div
      className="zt:ms-auto zt:-me-1.5 zt:flex zt:shrink-0 zt:items-center"
      onClick={claimClick}
    >
      {/* 70% is the floor the resting state can dim to and still read: at it
          the icon carries 3.26:1 against the header, and WCAG 1.4.11 asks 3:1
          of a control. 40% measured 1.84:1. */}
      <div className="zt:flex zt:items-center zt:opacity-70 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-data-selected:opacity-100 zt:motion-safe:transition-opacity">
        <IconButton
          icon="palette"
          className={BLOCKED_VERB_DIM}
          disabled={controls.color.disabled}
          data-blocked={controls.color.blocked ? "" : undefined}
          onClick={press(controls.color, (evt) =>
            actions.onColorMenu(evt, annot),
          )}
          {...tooltipAttrs(controls.color.tooltip)}
        />
        <IconButton
          icon={commentIcon(hasComment)}
          className={BLOCKED_VERB_DIM}
          active={editing}
          disabled={controls.comment.disabled}
          data-blocked={controls.comment.blocked ? "" : undefined}
          onClick={press(controls.comment, () => {
            if (!editing) actions.onOpenComment(annot);
            setEditing(editing ? null : annot.key);
          })}
          {...tooltipAttrs(controls.comment.tooltip)}
        />
      </div>
      <IconButton
        icon="more-horizontal"
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
 * drawer draw, at the tag's own padding.
 *
 * A chip is a filter toggle, so a tag seen on one card is the gesture that
 * narrows the list to it, and a chip already in the filter rests in the accent.
 */
function TagRow({ annot }: { annot: AnnotationRecord }) {
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  const toggleTag = useToggleSelectedTag();
  if (annot.tags.length === 0) return null;

  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1.5">
      {annot.tags.map((tag) => {
        const selected = selectedTags.includes(tag);
        return (
          <span
            key={tag}
            aria-pressed={selected}
            className={tagChipVariants({
              state: selected ? "selected" : "resting",
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
  const draft = useAnnotStore(
    (state) => state.commentDrafts.get(annot.key) ?? null,
  );
  const capability = useAnnotStore((state) => state.capability);
  if (editing) return <CommentEditor annot={annot} />;
  if (draft) {
    const controls = commentEditorControls(
      capability,
      draft,
      Temporal.Now.instant(),
    );
    return (
      <div>
        <div className="zt:text-xs zt:text-muted-foreground">
          {m.annot_view_comment_draft()}
        </div>
        <div className="zt:text-sm zt:break-words zt:whitespace-pre-wrap zt:text-foreground zt:select-text">
          {draft.text}
        </div>
        <div
          role="status"
          className="zt:mt-1 zt:text-xs zt:text-muted-foreground"
        >
          {controls.hint}
        </div>
      </div>
    );
  }
  if (annot.comment === null) return null;
  return (
    <Comment
      annot={annot}
      editable={!control.disabled && control.blocked === null}
    />
  );
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
        "markdown-rendered zt-annot-comment zt:overflow-x-auto zt:text-sm zt:break-words zt:text-foreground zt:select-text",
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
        actions.onOpenComment(annot);
        setEditing(annot.key);
      }}
    />
  );
}

/**
 * The comment editor, in the slot the rendered comment stood in, with the
 * caret at the end of what is already there.
 *
 * Escape and blur store the text and close the editor. Ctrl/Command+Enter
 * stores it and keeps the editor open.
 */
function CommentEditor({ annot }: { annot: AnnotationRecord }) {
  const labelId = useId();
  const actions = useContext(AnnotActionsContext);
  const setEditing = useSetEditingComment();
  const stored = annot.comment ?? "";
  const text = useAnnotStore(
    (state) => state.commentDrafts.get(annot.key)?.text ?? stored,
  );
  const capability = useAnnotStore((state) => state.capability);
  const draft = useAnnotStore(
    (state) => state.commentDrafts.get(annot.key) ?? null,
  );
  const controls = commentEditorControls(
    capability,
    draft,
    Temporal.Now.instant(),
  );
  const annotRef = useRef(annot);
  annotRef.current = annot;
  const editor = useRef<HTMLTextAreaElement>(null);
  const editorBinding = useRef<Disposable | null>(null);

  const focusEnd = useCallback(
    (el: HTMLTextAreaElement | null) => {
      editorBinding.current?.[Symbol.dispose]();
      editorBinding.current = null;
      editor.current = el;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      editorBinding.current = actions.bindCommentEditor(
        el,
        annotRef.current,
        () => el.value,
      );
    },
    [actions],
  );

  useLayoutEffect(() => {
    const el = editor.current;
    if (!el || el.value === text) return;
    const active = el.doc.activeElement === el;
    const { selectionStart, selectionEnd } = el;
    el.value = text;
    if (!active) return;
    el.focus();
    el.setSelectionRange(
      Math.min(selectionStart, text.length),
      Math.min(selectionEnd, text.length),
    );
  }, [text]);

  const save = (): void => {
    setEditing(null);
    if (text !== stored) actions.onSaveComment(annot, text, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (text !== stored) actions.onSaveComment(annot, text, true);
      setEditing(null);
    }
  };

  return (
    // Placing the caret is not the card's selection.
    <div onClick={(e) => e.stopPropagation()}>
      <span id={labelId} className="zt:sr-only">
        {m.annot_view_card_edit_comment()}
      </span>
      <textarea
        ref={focusEnd}
        className="zt:w-full zt:resize-none zt:bg-transparent zt:text-sm zt:text-foreground"
        defaultValue={text}
        readOnly={controls.readOnly}
        aria-labelledby={labelId}
        rows={Math.min(6, Math.max(2, text.split("\n").length + 1))}
        placeholder={m.annot_view_card_comment_placeholder()}
        onChange={(e) => actions.onEditComment(annot, e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (
            event.relatedTarget?.instanceOf(Node) &&
            event.currentTarget.parentElement?.contains(event.relatedTarget)
          )
            return;
          if (!controls.manual && !controls.readOnly) save();
        }}
      />
      <div className="zt:mt-2 zt:flex zt:flex-wrap zt:items-center zt:gap-2">
        <span
          role="status"
          className="zt:min-w-0 zt:flex-1 zt:text-xs zt:text-muted-foreground"
        >
          {controls.hint}
        </span>
        {controls.manual && (
          <Button
            disabled={controls.saveDisabled}
            onClick={() => actions.onSaveComment(annot, text)}
          >
            {m.annot_view_comment_save()}
          </Button>
        )}
      </div>
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
  const name = annot.type;

  if ((name === "note" || name === "text") && !annot.text) return null;

  const isImage = name === "image" || name === "ink";

  let content: React.ReactNode;
  if (isImage) {
    content = <ExcerptImage annot={annot} collapsed={collapsed} />;
  } else if (annot.text) {
    content = <ExcerptText text={annot.text} />;
  } else {
    content = m.annot_view_unsupported_type({ type: name });
  }

  return (
    // A quotation lifted out of a document, so it takes the reading face at
    // the one size named for that use. The clamp keeps its 1.5 leading:
    // three tight lines under a fade is the shape this redesign replaced.
    <blockquote
      className={cn(
        "zt:font-content zt:text-quote zt:text-pretty",
        collapsed && !isImage && "zt:line-clamp-3",
      )}
    >
      {content}
    </blockquote>
  );
}

function ExcerptImage({ annot, collapsed }: AnnotationProps) {
  const actions = useContext(AnnotActionsContext);
  const source = useAnnotStore((s) => s.annotationSource);
  const sourceScope = useAnnotStore((s) => s.annotationSourceScope);
  const heldTarget = useRef<ExcerptImageTarget | null>(null);
  const target = excerptImageTarget(heldTarget.current, {
    annotation: annot,
    source,
    sourceScope,
  });
  heldTarget.current = target;
  const demand = useMemo(() => actions.openExcerptImage(), [actions]);
  // A card states its demand as the record it paints moves; the demand lives on
  // until the card goes, so a replacement keeps the previous image it holds.
  useEffect(() => {
    demand.demand(actions.excerptImageRequest(target));
  }, [actions, demand, target]);
  useEffect(() => () => demand.release(), [demand]);
  const display = useSyncExternalStore(demand.subscribe, demand.snapshot);
  const owned = useRef<ExcerptImageOwnership | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  /** The image the card could not decode, which paints unavailable until another replaces it. */
  const [undecodable, setUndecodable] = useState<ExcerptImage | null>(null);
  useEffect(() => {
    const next = excerptImageOwnership({
      held: owned.current,
      display,
      identity: target.identity,
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
  }, [display, target.identity]);
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
      className={cn(
        // The edge is the excerpt's own: a rendered page is white on a white
        // card in the light scheme, and the hairline is what tells where the
        // image stops. The crop follows the reading direction.
        "zt:w-full zt:object-contain zt:object-left zt:ring-1 zt:ring-foreground/10 zt:ring-inset zt:rtl:object-right",
        collapsed && "zt:max-h-20",
      )}
      src={url}
      onError={() => {
        setUndecodable(display.image);
      }}
      alt={
        annot.text ??
        (annot.pageLabel === null
          ? m.annot_view_card_image_alt_no_page()
          : m.annot_view_card_image_alt({ page: annot.pageLabel }))
      }
    />
  );
}

/**
 * Where the Annotation is and what colour it was made in: a dot of the
 * highlight colour before the page, in the quiet 13px the row's glyphs sit
 * beside. The colour is data Zotero stored, so it rides in the card's own
 * `--zt-annot-color` and the declaration that reads it stays a utility; an
 * Annotation with no colour gets the page alone, which is the whole of what
 * "no colour" has to say.
 */
function PageLabel({
  page,
  color,
  backlink,
}: {
  page: string | null;
  color: string | null;
  backlink?: string;
}) {
  if (!page) return null;
  const label = m.annot_view_page({ page });
  const row =
    "zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:text-sm zt:text-muted-foreground zt:tabular-nums";
  const marks = (
    <>
      {color && (
        // The inset hairline holds a pale colour apart from the card's fill.
        <span className="zt:size-2 zt:shrink-0 zt:rounded-full zt:bg-(--zt-annot-color) zt:ring-1 zt:ring-foreground/10 zt:ring-inset" />
      )}
      <span className="zt:truncate">{label}</span>
    </>
  );
  if (backlink) {
    return (
      // Obsidian paints every `<a>` in the accent with an underline and marks
      // an external one with a boxed glyph, all unlayered; `zt-annot-page-link`
      // is where the view stylesheet takes the label back to the row's own ink,
      // keeping the underline for hover.
      <a
        className={cn("zt-annot-page-link", row)}
        href={backlink}
        // Opening the page in Zotero is its own verb, not the card's selection.
        onClick={(e) => e.stopPropagation()}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {marks}
      </a>
    );
  }
  return <span className={row}>{marks}</span>;
}
