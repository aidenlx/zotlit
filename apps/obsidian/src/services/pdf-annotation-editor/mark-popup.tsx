// The Mark Popup: one row of verbs over the selected Annotation Mark, on
// Obsidian's own hover popover, drawn by one Preact root.
//
// The popover has no target element, because a mark takes no pointer input and
// a page re-render wipes every node ZotLit could point at; it hangs from a
// virtual point instead. It shows at once rather than after a delay, because
// the create popup opens on the pointer release and the release's own `click`
// hides a popover still waiting to show. Only `isFocused` keeps one open with
// no target, so it is pinned at once — mouse-out and focus-out never close it,
// and the binding alone hides it.
//
// Each render is one synchronous diff, so the node under the pointer, the
// focused verb, and the verb a menu hangs from all stay through a refresh.
//
// @see apps/obsidian/docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md
// @see apps/obsidian/policies/hover-popover.md
import type { App, HoverParent, IconName } from "obsidian";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { IconButton } from "@/components/obsidian/icon-button";
import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { PopoutAwareHoverPopover } from "@/lib/popout-aware-hover-popover";
import { themeHook } from "@/lib/theme-hooks";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type {
  MutationState,
  WriteConflict,
} from "@/services/annotation-repository/write";
import {
  commentIcon,
  editingBlockedReason,
} from "@/views/annot-view/card-controls";
import type { HeldDraft } from "@/views/annot-view/card-controls";
import {
  CommentSheetSlot,
  CommentView,
  ConflictPanelSlot,
  HeldDraftSlot,
} from "@/views/annot-view/comment-parts";
import type { CommentSheetSlotProps } from "@/views/annot-view/comment-parts";
import type { CommentRenderer } from "@/views/annot-view/comment-render";
import { commentFrameClass } from "@/views/annot-view/comment-sheet";
import type { CommentDraftActions } from "@/views/annot-view/comment-sheet";
import { copiedText } from "@/views/annot-view/copied-text";

import type { Point } from "./hit-test";
import { MarkPopupTagSection } from "./mark-popup-tags";
import type { MarkPopupTagSectionProps } from "./mark-popup-tags";
import "./style.css";

/** Layout only; Obsidian's `clickable-icon` owns the look of each verb. */
const ROW_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5", "zt:p-1"];

export type MarkPopupVerbId =
  | "color"
  | "comment"
  | "tags"
  | "copy"
  | "delete"
  | "reveal";

/** Every control the row can hold: the six verbs, and the stack stepper. */
export type MarkPopupControlId = MarkPopupVerbId | "stack";

/**
 * What a pressed control runs.
 *
 * @param node the control pressed, which a menu opens beneath — so the pointer
 *   and the keyboard reach the same placement.
 */
export type MarkPopupActivate = (
  id: MarkPopupControlId,
  node: HTMLElement,
) => void;

/** One verb of the row: whether it runs, and what its tooltip says. */
export interface MarkPopupVerb {
  id: MarkPopupVerbId;
  icon: IconName;
  /** The accessible name, which Obsidian also renders as the hover tooltip. */
  tooltip: string;
  disabled: boolean;
  /** A toggle's state, or `null` for a verb that is not a toggle. */
  pressed: boolean | null;
}

/** Where the selected mark sits in the stack of marks under one point. */
export interface MarkStack {
  /** Zero-based position of the selected mark. */
  index: number;
  total: number;
}

/** The one stepper, which steps forward through the stack and wraps. */
export interface MarkPopupStepper {
  tooltip: string;
  /** What the control prints, e.g. `"1/3"`. */
  text: string;
}

/** The whole row, decided as data so nothing about it is settled in the DOM. */
export interface MarkPopupRow {
  verbs: readonly MarkPopupVerb[];
  /** The colour the palette verb shows, or `null` for an Annotation with none. */
  color: string | null;
  /** Absent while one mark alone sits under the point. */
  stepper: MarkPopupStepper | null;
}

export interface MarkPopupRowInput {
  annotation: AnnotationRecord;
  /** What this Attachment's Annotations may be edited to right now. */
  capability: EditingCapability;
  /** What the last write left on this Annotation. */
  mutation: MutationState;
  stack: MarkStack;
  /** Whether the comment editor stands open under the row. */
  commenting: boolean;
  /** Whether the tag editor stands open in the tag section. */
  tagging: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The verbs of the selected-mode row, in the order they are drawn.
 *
 * Copying and revealing never change Zotero, so neither ever stands down;
 * colour, comment, tags and delete follow the same rule the Annotation Card's
 * header does, because they are the same writes reached from another surface.
 * The creation row has no tag verb: the popup reopens on the new mark, where
 * tags can be added.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1148
 */
export function markPopupRow({
  annotation,
  capability,
  mutation,
  stack,
  commenting,
  tagging,
  now,
}: MarkPopupRowInput): MarkPopupRow {
  const blocked = editingBlockedReason(capability, mutation, now);
  const hasComment = annotation.comment !== null;
  const hasTags = annotation.tags.length > 0;
  const editing = (id: MarkPopupVerbId, icon: IconName, label: string) => ({
    id,
    icon,
    tooltip: blocked ?? label,
    disabled: blocked !== null,
    pressed: null,
  });
  return {
    color: annotation.color,
    verbs: [
      editing("color", "palette", m.annot_view_card_color()),
      {
        ...editing(
          "comment",
          commentIcon(hasComment),
          hasComment
            ? m.annot_view_card_edit_comment()
            : m.annot_view_card_add_comment(),
        ),
        pressed: commenting,
      },
      {
        ...editing(
          "tags",
          "tag",
          hasTags
            ? m.annot_view_card_edit_tags()
            : m.annot_view_card_add_tags(),
        ),
        pressed: tagging,
      },
      {
        id: "copy",
        icon: "copy",
        tooltip: m.annot_view_menu_copy_text(),
        disabled: copiedText([annotation]) === "",
        pressed: null,
      },
      editing("delete", "trash-2", m.annot_view_menu_delete()),
      {
        id: "reveal",
        icon: "panel-right-open",
        tooltip: m.pdf_mark_popup_reveal(),
        disabled: false,
        pressed: null,
      },
    ],
    stepper:
      stack.total > 1
        ? {
            tooltip: m.pdf_mark_popup_next_in_stack({
              position: stack.index + 1,
              total: stack.total,
            }),
            text: `${stack.index + 1}/${stack.total}`,
          }
        : null,
  };
}

/**
 * The row's verbs, then the stepper while marks overlap under the point.
 *
 * A blocked verb keeps its seat and carries the reason in its tooltip and its
 * accessible state, rather than leaving the row.
 *
 * @see apps/obsidian/policies/tooltips.md
 */
export function MarkPopupVerbs({
  row: { verbs, color, stepper },
  activate,
}: {
  row: MarkPopupRow;
  /** What a pressed control runs, against the node pressed. */
  activate: MarkPopupActivate;
}) {
  return (
    <>
      {verbs.map((verb) => (
        <MarkPopupControl
          key={verb.id}
          {...verb}
          // The palette wears the Annotation's own colour.
          color={verb.id === "color" ? color : null}
          onActivate={(node) => activate(verb.id, node)}
        />
      ))}
      {stepper && (
        <MarkPopupControl
          key="stack"
          id="stack"
          icon="chevrons-right"
          tooltip={stepper.tooltip}
          onActivate={(node) => activate("stack", node)}
        >
          <span className="zt:text-xs zt:tabular-nums">{stepper.text}</span>
        </MarkPopupControl>
      )}
    </>
  );
}

/**
 * Obsidian declares a `clickable-icon`'s colour unlayered, where no utility
 * reaches it, so a control's own colour is set on its glyph, which inherits
 * that colour rather than declaring one.
 */
const TINTED = "zt:[&_svg]:text-(--zt-verb-color)";

export interface MarkPopupControlProps {
  /** What the node carries in `data-zt-verb`. */
  id: string;
  icon: IconName;
  /** The accessible name, which Obsidian also renders as the hover tooltip. */
  tooltip: string;
  disabled?: boolean;
  /** The colour the control wears, or `null` for one that wears none. */
  color?: string | null;
  /** A toggle's state, or `null` for a control that is not a toggle. */
  pressed?: boolean | null;
  /** Classes beside Obsidian's own `clickable-icon`. */
  cls?: readonly string[];
  children?: ReactNode;
  /**
   * What a press runs, against the node pressed — which is what a menu opens
   * beneath, from the pointer and from the keyboard alike.
   */
  onActivate: (node: HTMLElement) => void;
}

/**
 * One control of a Mark Popup row, in either mode: an Obsidian
 * `clickable-icon` carrying its id in `data-zt-verb`, its accessible name and
 * tooltip, a toggle's state, and — for a swatch — its colour.
 *
 * A blocked control keeps its seat and its place in the tab order, and carries
 * the reason in its tooltip and its accessible state, rather than leaving the
 * row.
 *
 * @see apps/obsidian/policies/tooltips.md
 */
export function MarkPopupControl({
  id,
  icon,
  tooltip,
  disabled = false,
  color = null,
  pressed = null,
  cls,
  children,
  onActivate,
}: MarkPopupControlProps) {
  const style =
    color === null
      ? undefined
      : ({ "--zt-verb-color": color } as CSSProperties);
  return (
    <IconButton
      icon={icon}
      blocked={disabled}
      pressed={pressed ?? undefined}
      data-zt-verb={id}
      {...tooltipAttrs(tooltip)}
      className={cn(color !== null && TINTED, cls)}
      style={style}
      onClick={(event) => onActivate(event.currentTarget)}
    >
      {children}
    </IconButton>
  );
}

/**
 * The popup's content laid out as a column: the row of verbs, then whatever
 * stands under it — the comment sheet, a held draft, a Write Conflict, the tag
 * section. The row is centred, so a sheet that widens the popup leaves each
 * verb where the pointer pressed it.
 */
export function PopupColumn({
  row,
  children,
}: {
  row: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-1">
      <div className="zt:flex zt:items-center zt:gap-0.5 zt:self-center">
        {row}
      </div>
      {children}
    </div>
  );
}

/** What stands in the comment's place under the selected-mode row. */
export type SelectedPopupComment =
  /** The comment sheet, open on the shared draft. */
  | { kind: "sheet"; sheet: Omit<CommentSheetSlotProps, "app" | "surface"> }
  /** A held comment draft, in the stored comment's place. */
  | {
      kind: "held";
      held: HeldDraft;
      actions: CommentDraftActions;
      onOpen: () => void;
    }
  /** The stored comment, rendered. */
  | {
      kind: "view";
      html: string;
      editable: boolean;
      render: CommentRenderer;
      onOpen: () => void;
    };

export interface SelectedMarkPopupProps {
  app: App;
  row: MarkPopupRow;
  activate: MarkPopupActivate;
  /** What stands under the row in the comment's place; `null` for nothing. */
  comment: SelectedPopupComment | null;
  /** A Write Conflict on the comment, while its draft stands. */
  conflict: {
    conflict: WriteConflict;
    live: boolean;
    actions: CommentDraftActions;
  } | null;
  /** The tag section, while it stands. */
  tags: MarkPopupTagSectionProps | null;
}

/**
 * The popup in selected mode: the row, the comment in one of its states, a
 * Write Conflict, and the tag section, in that order. Each part keeps its seat
 * in the column, so a change to one leaves the others' nodes, and an open
 * editor's caret, where they stand.
 */
export function SelectedMarkPopup({
  app,
  row,
  activate,
  comment,
  conflict,
  tags,
}: SelectedMarkPopupProps) {
  return (
    <AppContext value={app}>
      <PopupColumn row={<MarkPopupVerbs row={row} activate={activate} />}>
        {comment?.kind === "sheet" && (
          <CommentSheetSlot app={app} surface="popup" {...comment.sheet} />
        )}
        {comment?.kind === "held" && (
          <HeldDraftSlot
            held={comment.held}
            surface="popup"
            actions={comment.actions}
            onOpen={comment.onOpen}
          />
        )}
        {comment?.kind === "view" && (
          <div className={commentFrameClass("popup")}>
            <CommentView
              surface="popup"
              render={comment.render}
              html={comment.html}
              editable={comment.editable}
              onOpen={comment.onOpen}
            />
          </div>
        )}
        {conflict && <ConflictPanelSlot surface="popup" {...conflict} />}
        {tags && <MarkPopupTagSection {...tags} />}
      </PopupColumn>
    </AppContext>
  );
}

export interface MarkPopupDeps {
  /** The hover parent, which is the binding rather than the PDF view, so
   *  Obsidian's Page Preview on that view keeps its own popover. */
  parent: HoverParent;
  /** The virtual point the popup hangs from, in client coordinates. */
  anchor: Point;
  /**
   * What the popup shows, run on open and on every refresh. `undefined`
   * leaves what it shows as it stands.
   */
  render: (content: HTMLElement) => ReactNode | undefined;
  /**
   * Runs as the popup hides, before its content unmounts: unmounting can end
   * an editor's session, and the store change that follows must find no
   * popup to refresh.
   */
  onHide?: () => void;
}

/**
 * One popup, retargeted from mark to mark rather than rebuilt per mark. The
 * creation surfaces open the same popup with their own row
 * (aidenlx/zotlit#1150).
 *
 * The root mounts as the popup opens and unmounts as it hides. A refresh that
 * a render itself sets off — an editor ending its session as it unmounts —
 * runs once that render is done, rather than inside it.
 */
export class MarkPopup extends PopoutAwareHoverPopover {
  readonly #content: HTMLElement;
  readonly #root: Root;
  readonly #render;
  #anchor: Point;
  #mounted = true;
  #rendering = false;
  #again = false;
  /** Centres the popup again as its content grows, such as a comment rendering. */
  #resize: ResizeObserver | null = null;
  #resizeWin: Window | null = null;

  constructor({ parent, anchor, render, onHide }: MarkPopupDeps) {
    super(parent, null, 0, anchor);
    this.#anchor = anchor;
    this.setIsFocused(true);
    this.hoverEl.addClass(themeHook.pdfMarkPopup);
    this.#render = render;
    this.#content = this.hoverEl.createDiv({
      cls: ["zt-root", ...ROW_CLASSES],
    });
    this.#root = createRoot(this.#content);
    this.register(() => {
      onHide?.();
      this.#resize?.disconnect();
      this.#mounted = false;
      this.#root.unmount();
    });
    this.refresh();
    this.showNow();
  }

  /**
   * Hang from another point. Scrolling and a page re-render both land here, so
   * it moves the popup and leaves its content alone; what the row says changes
   * through {@link MarkPopup.refresh}.
   */
  retarget(anchor: Point): void {
    this.#anchor = anchor;
    this.position();
  }

  /** Redraw the content where it stands, after what it acts on changed. */
  refresh(): void {
    if (this.#rendering) {
      this.#again = true;
      return;
    }
    this.#rendering = true;
    try {
      do {
        this.#again = false;
        if (!this.#mounted) return;
        const view = this.#render(this.#content);
        // Building the view can end a session whose store change hides the
        // popup, and a hidden popup's root is gone.
        if (view !== undefined && this.#mounted) this.#root.render(view);
      } while (this.#again);
    } finally {
      this.#rendering = false;
    }
  }

  /**
   * Obsidian hangs a popover's left edge from its point; the popup centres on
   * the anchor instead. The popover joins the document on its first placement,
   * so that placement runs twice: once to measure it, once to centre it.
   * Obsidian's viewport clamp still applies.
   */
  override position(): void {
    const { x, y } = this.#anchor;
    if (!this.hoverEl.isConnected) {
      this.staticPos = this.#anchor;
      super.position();
    }
    this.staticPos = { x: x - this.hoverEl.offsetWidth / 2, y };
    super.position();
    this.#watchResize();
  }

  /**
   * Watches the content from the window the popover now stands in, which a
   * popout changes.
   */
  #watchResize(): void {
    const win = this.hoverEl.win;
    if (!this.hoverEl.isConnected || this.#resizeWin === win) return;
    this.#resize?.disconnect();
    this.#resizeWin = win;
    const resize = new (win as Window & typeof globalThis).ResizeObserver(
      () => {
        if (this.hoverEl.isConnected) this.position();
      },
    );
    resize.observe(this.#content);
    this.#resize = resize;
  }
}
