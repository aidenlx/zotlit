import { Keymap } from "obsidian";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, RefObject } from "react";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import {
  activatable,
  claimClick,
  clickClaimed,
  cn,
  tooltipAttrs,
} from "@/lib/utils";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { ExcerptImage } from "@/services/excerpt-image/format";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";

import { AnnotActionsContext } from "./actions";
import type { AnnotActions } from "./actions";
import {
  cardControls,
  commentIcon,
  fieldEditorControls,
  editingLive,
  heldCommentDraft,
  heldTagDraft,
  hasQuotedText,
  shownText,
  shownTagNames,
  tagEditorControls,
} from "./card-controls";
import type { CardControl, CardControls, HeldDraft } from "./card-controls";
import {
  EditorSheetSlot,
  CommentView,
  ConflictPanelSlot,
  HeldDraftSlot,
} from "./comment-parts";
import { commentField, quotedTextField, selectsCards } from "./comment-sheet";
import type {
  CommentDraftActions,
  EditorField,
  EditorSheet,
  HeldDraftActions,
} from "./comment-sheet";
import {
  excerptImageOwnership,
  excerptImageTarget,
} from "./excerpt-image-state";
import type {
  ExcerptImageOwnership,
  ExcerptImageTarget,
} from "./excerpt-image-state";
import {
  fieldDraft,
  isEditing,
  selectedAlone,
  useAnnotStore,
  useEditingTarget,
  useMutation,
  useToggleSelectedTag,
} from "./store";
import type { TextEditingField } from "./store";
import { tagChipVariants } from "./tag-chip";
import { autoTags, HeldTagsPanel, TagEditor } from "./tag-editor";
import type { EndTagSession } from "./tag-editor";

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
 * to the notice that holds the explanation.
 */
const BLOCKED_VERB_DIM = "zt:data-blocked:opacity-50";

interface AnnotationProps {
  annot: AnnotationRecord;
  collapsed: boolean;
}

interface AnnotationCardProps extends AnnotationProps {
  /** Whether this card is the card list's one tab stop. */
  tabStop: boolean;
}

/**
 * Each control state is a fresh object, and the store is read through
 * `useSyncExternalStore`, which compares snapshots by identity — so it is built
 * from the slices it depends on and held while those are unchanged.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1146
 */
function useCardControls(
  annot: AnnotationRecord,
  alone: boolean,
): CardControls {
  const capability = useAnnotStore((s) => s.capability);
  const mutation = useMutation(annot.key);
  const hasComment = annot.comment !== null;
  const hasTags = annot.tags.length > 0;
  const { type } = annot;
  return useMemo(
    () =>
      cardControls({
        capability,
        mutation,
        hasComment,
        hasTags,
        type,
        alone,
        // A card's tooltip is read at the moment it is drawn; the ticking
        // countdown belongs to the toolbar affordance, not to every card.
        now: Temporal.Now.instant(),
      }),
    [capability, mutation, hasComment, hasTags, type, alone],
  );
}

/** One row of the card list's grid, its content in one cell. */
export function Annotation({ annot, collapsed, tabStop }: AnnotationCardProps) {
  const actions = useContext(AnnotActionsContext);
  const selected = useAnnotStore((s) =>
    s.cardSelection.selected.includes(annot.key),
  );
  /**
   * A card selected alone opens its full text and brings up its verbs; one
   * selected with others stays compact and shows the selected highlight only.
   */
  const alone = useAnnotStore((s) => selectedAlone(s, annot.key));
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "comment"));
  const controls = useCardControls(annot, alone);
  const endSession = useRef<EndTagSession | null>(null);

  return (
    <div
      className="zt-annot-card zt:group zt:overflow-hidden zt:rounded-(--bases-kanban-card-radius) zt:bg-(--bases-kanban-card-background) zt:px-3 zt:py-2 zt:text-xs zt:leading-(--line-height-tight) zt:shadow-(--bases-kanban-card-shadow) zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:motion-safe:transition-colors"
      // The card is the surface Obsidian draws for a Bases card: its fill, its
      // radius and its hairline-and-drop shadow are read from the same theme
      // variables, so a theme that restyles Bases cards restyles these. Inside,
      // it is set as a search result's match is: 12px on the tight leading in
      // 8px by 12px of padding, its parts stacked on a 6px gap with no divider
      // rule between them. The chip at the top and the tag chips at the bottom
      // each carry their own air inside the 8px, which is what keeps the two
      // insets reading as one.
      //
      // Zotero's hex is data, so it rides in a custom property and
      // `data-annot-color` says it is there; the declaration that reads them
      // stays a utility. The colour is drawn on the page chip — the one mark
      // that carries what the Annotation is, where it is and what colour it
      // was made in — and again as the rule beside the excerpt, which is the
      // reader's own way of saying "this is the document's text".
      style={{ "--zt-annot-color": annot.color } as React.CSSProperties}
      data-annot-color={annot.color ?? undefined}
      data-zotero-annotation-key={annot.key}
      data-selected={selected ? "" : undefined}
      data-alone={alone ? "" : undefined}
      role="row"
      aria-selected={selected}
      // A card takes focus from a click and holds it, which is what the
      // Annotation History keys read to know the card is the surface the key
      // belongs to. The list is one tab stop, and ↑ and ↓ move from there: a
      // list of hundreds of cards would otherwise be that many stops on the
      // way past it.
      tabIndex={tabStop ? 0 : -1}
      // Shift-click takes a range of cards, not a run of the page's text; a
      // text field keeps its own Shift-click.
      onMouseDown={(e) => {
        if (!e.shiftKey || inTextEntry(e.target)) return;
        // A control keeps its press, and the focus it takes.
        const target = e.target as Node;
        if (
          target.instanceOf(Element) &&
          target.closest('button, a, [role="button"]')
        )
          return;
        e.preventDefault();
      }}
      onClick={(e) => {
        // A control inside the card already answered this click; the card's
        // selection is not it, and the control keeps the focus.
        if (clickClaimed(e)) return;
        // The list is already where the user clicked, so the focus moves
        // without scrolling it.
        e.currentTarget.focus({ preventScroll: true });
        actions.onSelectAnnotation(
          annot,
          e.shiftKey
            ? "range"
            : Keymap.isModifier(e.nativeEvent, "Mod")
              ? "toggle"
              : "click",
        );
      }}
      // A right-click opens the "…" menu at the pointer. A text field keeps
      // its own menu.
      onContextMenu={(e) => {
        if (inTextEntry(e.target)) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        actions.onCardMenu(e, annot);
      }}
    >
      {/* A grid row holds its content in a cell; the card's parts stack in it. */}
      <div role="gridcell" className="zt:flex zt:flex-col zt:gap-1.5">
        {/* One 22px box metric for every member of the row, so the chip and the
            verbs sit on one line rather than two: the card's `clickable-icon`
            is the one Obsidian draws in a property row, a 14px glyph in 4px of
            padding, set in `style.css`. The end control pulls back by that
            padding, which lands its glyph on the card's text edge instead of
            4px inside it. */}
        <div className="zt:flex zt:items-center zt:gap-1">
          <PageChip
            type={annot.type}
            page={annot.pageLabel}
            color={annot.color}
            backlink={actions.getBacklink(annot)}
            onDragStart={(e) => {
              // The ghost under the pointer is the whole card, held where the
              // pointer took it, rather than the chip alone.
              const card = e.currentTarget.closest(".zt-annot-card");
              if (card?.instanceOf(HTMLElement)) {
                const rect = card.getBoundingClientRect();
                e.dataTransfer.setDragImage(
                  card,
                  e.clientX - rect.left,
                  e.clientY - rect.top,
                );
              }
              actions.onDragStart(e, annot);
            }}
          />
          <CardActionBar
            annot={annot}
            controls={controls}
            editing={editing}
            endSession={endSession}
          />
        </div>

        <ConflictSlot annot={annot} />

        <ExcerptBlock annot={annot} collapsed={collapsed} alone={alone} />

        <CommentSlot
          annot={annot}
          editing={editing}
          control={controls.comment}
        />

        <TagSlot annot={annot} endSession={endSession} />
      </div>
    </div>
  );
}

/**
 * Zotero's copy of this Annotation moved under the user's write, so the card
 * puts the fresh Zotero value beside what the user asked for and offers the
 * two verbs that end it. The write's Pending Proposal went with the conflict,
 * so the card around this panel shows what Zotero holds.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1151
 */
function ConflictSlot({ annot }: { annot: AnnotationRecord }) {
  const actions = useContext(AnnotActionsContext);
  const mutation = useMutation(annot.key);
  const live = useAnnotStore((state) => editingLive(state.capability));
  if (mutation.kind !== "conflict") return null;
  return (
    <ConflictPanelSlot
      conflict={mutation.conflict}
      live={live}
      surface="card"
      actions={cardDraftActions(actions, annot, annot.comment ?? "")}
    />
  );
}

/** The panels' verbs, bound to the Annotation View's own actions. */
function cardDraftActions(
  actions: AnnotActions,
  annot: AnnotationRecord,
  text: string,
): CommentDraftActions {
  return {
    save: () => actions.onSaveComment(annot, text),
    allowEditing: () => actions.onAllowEditing(),
    discard: () => actions.onDiscardComment(annot),
    applyAgain: () => actions.onApplyAgain(annot),
    discardConflict: () => actions.onDiscardConflict(annot),
  };
}

/** The held tags panel's verbs, bound to the Annotation View's own actions. */
function cardHeldTagsActions(
  actions: AnnotActions,
  annot: AnnotationRecord,
): HeldDraftActions {
  return {
    // Save tags is the explicit save, never the editor's automatic one.
    save: () => actions.onSaveTags(annot),
    allowEditing: () => actions.onAllowEditing(),
    discard: () => actions.onDiscardTags(annot),
  };
}

/**
 * The card's verbs, as the same `clickable-icon` row the Mark Popup draws over
 * a selected mark, so a write reached from either surface wears the same
 * control.
 *
 * The editing verbs — Edit text, colour, comment and tags — rest dimmed and come
 * up to full on hover, while focus is inside the card so the keyboard reaches
 * them, and while the card is selected alone. The overflow control never dims: it is
 * the only route to copying, revealing and deleting.
 *
 * @see apps/obsidian/src/services/pdf-annotation-editor/mark-popup.ts
 */
function CardActionBar({
  annot,
  controls,
  editing,
  endSession,
}: {
  annot: AnnotationRecord;
  controls: CardControls;
  editing: boolean;
  /** Ends the open tag session through its editor, typed text and all. */
  endSession: RefObject<EndTagSession | null>;
}) {
  const actions = useContext(AnnotActionsContext);
  const comment = useEditingTarget(annot.key, "comment");
  const hasComment = annot.comment !== null;
  const tags = useTagSession(annot);
  const text = useEditingTarget(annot.key, "text");
  const editingText = useAnnotStore((s) => isEditing(s, annot.key, "text"));
  const shownQuotedText = useShownText(annot, "text");

  /**
   * What one verb's press does. A verb the Editing Capability blocks keeps its
   * press and spends it on a notice instead of on the write: the reason lives
   * there, and a control that refused the press could never reach it.
   */
  const press =
    (control: CardControl, act: (evt: MouseEvent<HTMLElement>) => void) =>
    (evt: MouseEvent<HTMLElement>): void => {
      if (control.blocked) {
        actions.onBlockedPress(control.blocked);
        return;
      }
      act(evt);
    };

  return (
    // The card's own click takes the selection; a verb is not that. The row
    // claims the click once, rather than each control claiming it itself.
    <div
      className="zt:ms-auto zt:-me-1 zt:flex zt:shrink-0 zt:items-center"
      onClick={claimClick}
    >
      {/* 70% is the floor the resting state can dim to and still read: at it
          the icon carries 3.26:1 against the header, and WCAG 1.4.11 asks 3:1
          of a control. 40% measured 1.84:1. */}
      <div className="zt:flex zt:items-center zt:opacity-70 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-data-alone:opacity-100 zt:motion-safe:transition-opacity">
        {controls.text && (
          <IconButton
            icon="text-cursor-input"
            className={BLOCKED_VERB_DIM}
            active={editingText}
            disabled={controls.text.disabled}
            data-blocked={controls.text.blocked ? "" : undefined}
            onClick={press(controls.text, () => {
              if (editingText) {
                // A second press saves and closes, as Done does.
                text.close();
                actions.onSaveText(annot, shownQuotedText, true);
              } else if (actions.onOpenText(annot)) text.open();
            })}
            {...tooltipAttrs(controls.text.tooltip)}
          />
        )}
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
            if (editing) comment.close();
            else if (actions.onOpenComment(annot)) comment.open();
          })}
          {...tooltipAttrs(controls.comment.tooltip)}
        />
        <IconButton
          icon="tag"
          className={BLOCKED_VERB_DIM}
          active={tags.open}
          disabled={controls.tags.disabled}
          data-blocked={controls.tags.blocked ? "" : undefined}
          // An open editor keeps the focus through this press, so the press
          // itself is what closes it rather than the blur before it.
          onMouseDown={(evt) => {
            if (tags.open) evt.preventDefault();
          }}
          onClick={press(controls.tags, () => {
            if (tags.open) endSession.current?.();
            else tags.start();
          })}
          {...tooltipAttrs(controls.tags.tooltip)}
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
 * One card's tag editing session, as the toggle and the tag row read it. The
 * editor is open while the user holds it open. A blur saves the session and
 * keeps the editor open for the next one; Escape, the toggle and a view
 * gesture close it. Each save shows as the session's Pending Proposal, which
 * the record carries until Zotero answers.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
function useTagSession(annot: AnnotationRecord) {
  const actions = useContext(AnnotActionsContext);
  const target = useEditingTarget(annot.key, "tags");
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "tags"));
  const draft = useAnnotStore((s) => s.tagDrafts.get(annot.key) ?? null);
  const save = (): void => actions.onSaveTags(annot, { automatic: true });
  return {
    draft,
    open: editing,
    start: (): void => {
      if (actions.onOpenTags(annot)) target.open();
    },
    close: (): void => {
      target.close();
      save();
    },
    /** Focus left the editor: the session saves, and the editor stays open. */
    leave: save,
  };
}

/**
 * The tag row, or the tag editor in its place. The tag control in the action
 * bar alone opens the editor, as the Mark Popup's tag verb does.
 */
function TagSlot({
  annot,
  endSession,
}: {
  annot: AnnotationRecord;
  endSession: RefObject<EndTagSession | null>;
}) {
  const actions = useContext(AnnotActionsContext);
  const session = useTagSession(annot);
  const auto = useMemo(() => autoTags(annot), [annot]);
  const capability = useAnnotStore((s) => s.capability);
  const { draft } = session;
  const now = Temporal.Now.instant();
  const editor = tagEditorControls(capability, draft, now);
  // A fresh value on each render: the held panel compares it by value
  // before it draws again.
  const held = heldTagDraft(capability, draft, now);
  // Editing that becomes unavailable closes the editor, which holds the
  // draft for Save tags.
  if (session.open && !editor.readOnly) {
    return (
      // Editing is not the card's selection. The handler is a function of its
      // own: Preact records when a handler was first attached on the function
      // itself and skips it for an event that began earlier, so the shared
      // `claimClick` mounted here by the toggle's press would silence the
      // action bar's claim of that same press.
      <div onClick={(e) => claimClick(e)}>
        <TagEditor
          names={shownTagNames(annot, draft)}
          auto={auto}
          hint={editor.hint}
          libraryNames={() => actions.libraryTagNames(annot)}
          onChange={(names) => actions.onEditTags(annot, names)}
          onClose={session.close}
          onLeave={session.leave}
          saving={draft?.state.kind === "pending"}
          endSession={endSession}
        />
      </div>
    );
  }
  if (held) {
    return (
      // The panel is the draft's own surface; the card's selection is not it.
      <div onClick={(e) => claimClick(e)}>
        <HeldTagsPanel
          held={held}
          surface="card"
          actions={cardHeldTagsActions(actions, annot)}
        />
      </div>
    );
  }
  return <TagRow names={shownTagNames(annot, draft)} />;
}

/**
 * The Annotation's own tags, in the card rather than behind a control: a
 * researcher scanning a column reads what an Annotation is filed under without
 * opening anything. They wear the same native-tag chip the filter bar and its
 * drawer draw, dense, because the card is the densest of the three surfaces.
 *
 * A chip is a filter toggle, so a tag seen on one card is the gesture that
 * narrows the list to it, and a chip already in the filter rests in the accent.
 *
 * @param names the names the row draws: a tag draft's while one stands, and
 *   the Annotation's own otherwise. The filter reads the Annotation's own.
 */
function TagRow({ names }: { names: readonly string[] }) {
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  const toggleTag = useToggleSelectedTag();
  if (names.length === 0) return null;

  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1">
      {names.map((tag) => {
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
  const draft = useAnnotStore((state) =>
    fieldDraft(state, "comment", annot.key),
  );
  const capability = useAnnotStore((state) => state.capability);
  // Held by identity while the draft and the capability stand, so the panel
  // redraws on a change and not on every render of the card.
  const held = useMemo(
    () => heldCommentDraft(capability, draft, Temporal.Now.instant()),
    [capability, draft],
  );
  if (editing) return <FieldEditor annot={annot} field="comment" />;
  // A draft the plugin still resolves by itself draws nothing of its own: the
  // card keeps showing what Zotero holds until the write lands or the draft
  // turns into something the user must answer.
  if (held) return <HeldDraftPanel annot={annot} held={held} />;
  if (annot.comment === null) return null;
  return (
    <Comment
      annot={annot}
      editable={!control.disabled && control.blocked === null}
    />
  );
}

/**
 * The text the user holds that Zotero has not taken, with the verbs that end
 * it. It wears the Write Conflict panel's surface because it is the same kind
 * of state — local text waiting on the user — and it carries its verbs for the
 * same reason: a card that only says "unsaved" leaves nowhere to go.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1145
 */
function HeldDraftPanel({
  annot,
  held,
}: {
  annot: AnnotationRecord;
  held: HeldDraft;
}) {
  const actions = useContext(AnnotActionsContext);
  const editing = useEditingTarget(annot.key, "comment");
  return (
    <HeldDraftSlot
      held={held}
      surface="card"
      actions={cardDraftActions(actions, annot, held.text)}
      onOpen={() => {
        if (actions.onOpenComment(annot)) editing.open();
      }}
      // The panel is the draft's own surface; the card's selection is not it.
      // A Shift or Cmd/Ctrl click off its verbs is the card's own gesture.
      onClick={(e) => {
        const target = e.target as Node;
        if (
          selectsCards(e.nativeEvent, "card") &&
          !(target.instanceOf(Element) && target.closest("button"))
        )
          return;
        claimClick(e);
      }}
    />
  );
}

/** The rendered comment, as the Mark Popup draws it; see {@link CommentView}. */
function Comment({
  annot,
  editable,
}: {
  annot: AnnotationRecord;
  editable: boolean;
}) {
  const actions = useContext(AnnotActionsContext);
  const editing = useEditingTarget(annot.key, "comment");
  return (
    <CommentView
      surface="card"
      render={actions.renderComment}
      html={annot.comment ?? ""}
      editable={editable}
      onOpen={() => {
        if (actions.onOpenComment(annot)) editing.open();
      }}
    />
  );
}

/**
 * What the card's field editor reads and calls for each text field: its
 * wording, the confirmed value it opens on, and the actions that edit and
 * save its draft.
 */
const CARD_FIELDS: Record<
  TextEditingField,
  {
    wording: () => EditorField;
    confirmed: (annot: AnnotationRecord) => string | null;
    /** The action that takes each change into the field's draft. */
    edit: (actions: AnnotActions) => AnnotActions["onEditComment"];
    /** The action that stores the field's text, automatically or on request. */
    save: (actions: AnnotActions) => AnnotActions["onSaveComment"];
  }
> = {
  comment: {
    wording: commentField,
    confirmed: (annot) => annot.comment,
    edit: (actions) => actions.onEditComment,
    save: (actions) => actions.onSaveComment,
  },
  text: {
    wording: quotedTextField,
    confirmed: (annot) => annot.text,
    edit: (actions) => actions.onEditText,
    save: (actions) => actions.onSaveText,
  },
};

/** The text one field's editor opens on: its draft's, or the confirmed value. */
function useShownText(
  annot: AnnotationRecord,
  field: TextEditingField,
): string {
  return useAnnotStore((state) =>
    shownText(
      CARD_FIELDS[field].confirmed(annot),
      fieldDraft(state, field, annot.key),
    ),
  );
}

/**
 * One text field's editor, in the slot its text stood in, with the caret at
 * the end of what is already there: the comment under the excerpt, or the
 * Quoted Text in the Excerpt Block beside the colour rule. It is the shared
 * editor sheet; see {@link EditorSheetSlot}.
 *
 * Escape and Done store the text and close the editor. Blur and
 * Ctrl/Command+Enter store it and keep the editor open: a click in the PDF
 * beside the card, or a menu that takes the focus, is not the end of the
 * edit, and a reader change waits for the editor to close. A view gesture
 * that changes the Card Selection closes it as well.
 */
function FieldEditor({
  annot,
  field,
}: {
  annot: AnnotationRecord;
  field: TextEditingField;
}) {
  const actions = useContext(AnnotActionsContext);
  const editing = useEditingTarget(annot.key, field);
  const spec = CARD_FIELDS[field];
  const text = useShownText(annot, field);
  const capability = useAnnotStore((state) => state.capability);
  const draft = useAnnotStore((state) => fieldDraft(state, field, annot.key));
  const controls = fieldEditorControls(
    capability,
    draft,
    Temporal.Now.instant(),
  );
  const app = useObsidianApp();
  const sheet = useRef<EditorSheet | null>(null);

  // Every close asks for the submit, including one that changed nothing: the
  // request is what drops a draft holding only what Zotero already has, so
  // clicking the card out of an untouched editor leaves no held text behind.
  const save = (): void => {
    editing.close();
    spec.save(actions)(annot, text, true);
  };
  /** Blur: the same automatic submit, with the editor left open. */
  const saveOnLeave = (): void => spec.save(actions)(annot, text, true);
  const store = (): void => {
    if (sheet.current) spec.save(actions)(annot, sheet.current.text());
  };

  return (
    // Placing the caret is not the card's selection, and its keys are the
    // editor's own.
    <EditorSheetSlot
      app={app}
      surface="card"
      field={spec.wording()}
      value={text}
      text={text}
      status={controls}
      sheetRef={sheet}
      onChange={(value) => spec.edit(actions)(annot, value)}
      onSubmit={store}
      onSave={store}
      onCancel={save}
      onDone={save}
      onLeave={saveOnLeave}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => e.stopPropagation()}
    />
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
  alone,
}: {
  annot: AnnotationRecord;
  collapsed: boolean;
  /** Selected alone: the text opens in full; the image keeps its list size. */
  alone: boolean;
}) {
  const name = annot.type;
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "text"));
  const isImage = name === "image" || name === "ink";

  // A note or free text quotes nothing: its text, where it has one, stands in
  // the block, and otherwise there is no block.
  if (!isImage && !hasQuotedText(name) && !annot.text) return null;

  let content: React.ReactNode;
  if (isImage) {
    content = <ExcerptImage annot={annot} collapsed={collapsed} />;
  } else if (editing) {
    content = <FieldEditor annot={annot} field="text" />;
  } else if (annot.text) {
    content = <ExcerptText text={annot.text} />;
  } else if (hasQuotedText(name)) {
    // A cleared Quoted Text says so, so the card still shows where it goes.
    content = (
      <p className="zt:text-muted-foreground zt:italic">
        {m.annot_view_card_no_text()}
      </p>
    );
  } else {
    content = m.annot_view_unsupported_type({ type: name });
  }

  return (
    // The excerpt reads as a search result's match does: the card's own 12px
    // on the tight leading, in the full ink, behind a 2px rule in the
    // Annotation's colour — the reader's own mark for the document's text, and
    // what tells the excerpt from the comment the user wrote under it. An
    // Annotation with no colour gets the rule in the border ink. The clamp cuts
    // it at three lines.
    <blockquote
      className={cn(
        "zt:border-s-2 zt:ps-2 zt:text-pretty",
        annot.color ? "zt:border-(--zt-annot-color)" : "zt:border-border",
        collapsed && !alone && !isImage && !editing && "zt:line-clamp-3",
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
        // image stops. The collapsed image keeps its own aspect ratio inside
        // the height cap, so the box it wears the ring on is the picture's.
        "zt:max-w-full zt:ring-1 zt:ring-foreground/10 zt:ring-inset",
        collapsed ? "zt:max-h-20" : "zt:w-full",
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
 * What the Annotation is, where it is and what colour it was made in, as one
 * chip: the type glyph in the highlight colour before the page, on a fill of
 * that colour at 22%, a 20px box centred on the 22px row the verbs wear, with
 * a 12px glyph so the chip reads a step lighter than a verb. The page is a
 * locator, so it is set in the monospace face at 11px, which reads as a
 * reference rather than as a word of the excerpt below it; `zt-annot-page-chip`
 * is where the view stylesheet sets that size, one step under the card's own. The colour is data Zotero stored,
 * so it rides in the card's own `--zt-annot-color` and the declarations that
 * read it stay utilities; an Annotation with no colour gets the glyph in the
 * muted ink on no fill, which is the whole of what "no colour" has to say.
 *
 * The chip is the card's drag handle. Where a note is open to take it, the
 * drag rides on it; where the Annotation has a backlink, its click opens the
 * page in Zotero, and otherwise the click falls through to the card's own
 * selection.
 */
function PageChip({
  type,
  page,
  color,
  backlink,
  onDragStart,
}: {
  type: ResolvedAnnotationTypeName;
  page: string | null;
  color: string | null;
  backlink?: string;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
}) {
  const chip = cn(
    "zt-annot-page-chip zt:flex zt:h-5 zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-sm zt:px-1 zt:font-mono zt:font-medium zt:tabular-nums",
    color
      ? "zt:bg-(--zt-annot-color)/22 zt:text-foreground zt:hover:ring-1 zt:hover:ring-(--zt-annot-color) zt:motion-safe:transition-shadow"
      : "zt:text-muted-foreground",
  );
  const marks = (
    <>
      <Icon
        name={typeIcon(type)}
        size={12}
        className={cn("zt:shrink-0", color && "zt:text-(--zt-annot-color)")}
      />
      {page && (
        <span className="zt:truncate">{m.annot_view_page({ page })}</span>
      )}
    </>
  );
  if (backlink) {
    return (
      // Obsidian paints every `<a>` in the accent with an underline and marks
      // an external one with a boxed glyph, all unlayered; `zt-annot-page-link`
      // is where the view stylesheet takes the chip back to its own ink.
      <a
        className={cn("zt-annot-page-link", chip)}
        href={backlink}
        draggable
        onDragStart={onDragStart}
        // Opening the page in Zotero is its own verb, not the card's selection.
        onClick={(e) => e.stopPropagation()}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {marks}
      </a>
    );
  }
  return (
    <span className={chip} draggable onDragStart={onDragStart}>
      {marks}
    </span>
  );
}
