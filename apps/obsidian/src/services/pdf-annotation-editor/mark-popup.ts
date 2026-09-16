// The Mark Popup: one row of verbs over the selected Annotation Mark, on
// Obsidian's own hover popover.
//
// The popover has no target element, because a mark takes no pointer input and
// a page re-render wipes every node ZotLit could point at; it hangs from a
// virtual point instead. A fresh popover always waits its delay before the
// first `show()`, so the delay is zero, and only `isFocused` keeps one open
// with no target, so it is pinned at once — mouse-out and focus-out never close
// it, and the binding alone hides it.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see apps/obsidian/policies/hover-popover.md
import { setIcon, setTooltip } from "obsidian";
import type { HoverParent, IconName } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { PopoutAwareHoverPopover } from "@/lib/popout-aware-hover-popover";
import { themeHook } from "@/lib/theme-hooks";
import { onActivateKey } from "@/lib/utils";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { MutationState } from "@/services/annotation-repository/write";
import {
  commentIcon,
  editingBlockedReason,
} from "@/views/annot-view/card-controls";

import type { Point } from "./hit-test";
import "./style.css";

/** Layout only; Obsidian's `clickable-icon` owns the look of each verb. */
const ROW_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5", "zt:p-1"];

export type MarkPopupVerbId =
  | "color"
  | "comment"
  | "copy"
  | "delete"
  | "reveal";

/** Every control the row can hold: the five verbs, and the stack stepper. */
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
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The verbs of the selected-mode row, in the order they are drawn.
 *
 * Copying and revealing never change Zotero, so neither ever stands down;
 * colour, comment and delete follow the same rule the Annotation Card's header
 * does, because they are the same three writes reached from another surface.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1148
 */
export function markPopupRow({
  annotation,
  capability,
  mutation,
  stack,
  now,
}: MarkPopupRowInput): MarkPopupRow {
  const blocked = editingBlockedReason(capability, mutation, now);
  const hasComment = annotation.comment !== null;
  const editing = (id: MarkPopupVerbId, icon: IconName, label: string) => ({
    id,
    icon,
    tooltip: blocked ?? label,
    disabled: blocked !== null,
  });
  return {
    color: annotation.color,
    verbs: [
      editing("color", "palette", m.annot_view_card_color()),
      editing(
        "comment",
        commentIcon(hasComment),
        hasComment
          ? m.pdf_mark_popup_edit_comment()
          : m.pdf_mark_popup_add_comment(),
      ),
      {
        id: "copy",
        icon: "copy",
        tooltip: m.annot_view_menu_copy_text(),
        disabled: annotation.text === null,
      },
      editing("delete", "trash-2", m.annot_view_menu_delete()),
      {
        id: "reveal",
        icon: "panel-right-open",
        tooltip: m.pdf_mark_popup_reveal(),
        disabled: false,
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
 * Draws one row into the popup's content element, replacing what it held.
 *
 * A blocked verb keeps its seat and carries the reason in its tooltip and its
 * accessible state, rather than leaving the row.
 *
 * @param activate what a pressed control runs, against the node pressed — which
 *   is what a menu opens beneath, from the pointer and from the keyboard alike.
 * @see apps/obsidian/policies/tooltips.md
 */
export function renderMarkPopupRow(
  row: HTMLElement,
  { verbs, color, stepper }: MarkPopupRow,
  activate: MarkPopupActivate,
): void {
  row.empty();
  for (const verb of verbs) {
    markPopupControl(
      row,
      // The palette wears the Annotation's own colour.
      { ...verb, color: verb.id === "color" ? color : null },
      (node) => activate(verb.id, node),
    );
  }
  if (!stepper) return;
  const node = markPopupControl(
    row,
    { id: "stack", icon: "chevrons-right", ...stepper },
    (pressed) => activate("stack", pressed),
  );
  node.createSpan({ cls: "zt:text-xs zt:tabular-nums", text: stepper.text });
}

/**
 * One control of a Mark Popup row, in either mode: an Obsidian
 * `clickable-icon` carrying its id in `data-zt-verb`, its accessible name and
 * tooltip, and — for a swatch — its colour through the element's own style,
 * where a stylesheet's rules can still reach it and `var()` still substitutes.
 *
 * A blocked control keeps its seat and carries the reason in its tooltip and
 * its accessible state, rather than leaving the row.
 *
 * @param activate what a press runs, against the node pressed — which is what a
 *   menu opens beneath, from the pointer and from the keyboard alike.
 * @see apps/obsidian/policies/tooltips.md
 */
export function markPopupControl(
  row: HTMLElement,
  {
    id,
    icon,
    tooltip,
    disabled = false,
    color = null,
  }: {
    id: string;
    icon: IconName;
    tooltip: string;
    disabled?: boolean;
    color?: string | null;
  },
  activate: (node: HTMLElement) => void,
): HTMLElement {
  const node = row.createDiv({
    cls: "clickable-icon",
    attr: { role: "button", tabindex: "0" },
  });
  node.dataset.ztVerb = id;
  setTooltip(node, tooltip);
  setIcon(node, icon);
  if (color !== null) node.style.color = color;
  if (disabled) {
    node.addClass("is-disabled");
    node.setAttribute("aria-disabled", "true");
    return node;
  }
  node.addEventListener("click", () => activate(node));
  node.addEventListener("keydown", (event) =>
    onActivateKey(event, () => activate(node)),
  );
  return node;
}

export interface MarkPopupDeps {
  /** The hover parent, which is the binding rather than the PDF view, so
   *  Obsidian's Page Preview on that view keeps its own popover. */
  parent: HoverParent;
  /** The virtual point the popup hangs from, in client coordinates. */
  anchor: Point;
  /** Fills the content row; run on open and on every rebuild. */
  render: (row: HTMLElement) => void;
}

/**
 * One popup, retargeted from mark to mark rather than rebuilt per mark. The
 * creation surfaces open the same popup with their own row
 * (aidenlx/zotlit#1150).
 */
export class MarkPopup extends PopoutAwareHoverPopover {
  readonly #row: HTMLElement;
  readonly #render;

  constructor({ parent, anchor, render }: MarkPopupDeps) {
    super(parent, null, 0, anchor);
    this.setIsFocused(true);
    this.hoverEl.addClass(themeHook.pdfMarkPopup);
    this.#render = render;
    this.#row = this.hoverEl.createDiv({ cls: ["zt-root", ...ROW_CLASSES] });
    this.refresh();
  }

  /**
   * Hang from another point. Scrolling and a page re-render both land here, so
   * it moves the popup and leaves its content alone; what the row says changes
   * through {@link MarkPopup.refresh}.
   */
  retarget(anchor: Point): void {
    this.staticPos = anchor;
    this.position();
  }

  /** Redraw the row where it stands, after what it acts on changed. */
  refresh(): void {
    this.#render(this.#row);
  }
}
