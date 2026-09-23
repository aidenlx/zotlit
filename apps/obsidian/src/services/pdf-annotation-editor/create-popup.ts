// The Mark Popup in create mode: the row a settled text selection offers.
//
// The popup itself is the same one a selected mark hangs under — this module
// supplies its row and nothing else.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
import type { IconName } from "obsidian";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { MutationState } from "@/services/annotation-repository/write";
import { editingBlockedReason } from "@/views/annot-view/card-controls";

import { markPopupControl } from "./mark-popup";
import type { AnnotationTool, MarkTool } from "./tools";

/** What a pressed control of the create-mode row asks for. */
export type CreatePopupAction =
  /** Create the selection as this mark, in that tool's own colour. */
  | { kind: "tool"; tool: MarkTool }
  /** Create the selection in this colour, with the armed tool. */
  | { kind: "color"; color: string }
  /** Open or close the comment sheet. */
  | { kind: "comment" }
  /** Put the quoted text on the clipboard; never a write. */
  | { kind: "copy" };

/** One control of the create-mode row, decided as data. */
export interface CreatePopupControl {
  /** What the node carries in `data-zt-verb`. */
  id: string;
  icon: IconName;
  /** The accessible name, which Obsidian also renders as the hover tooltip. */
  tooltip: string;
  disabled: boolean;
  /** The swatch this control wears, or `null` for one that wears none. */
  color: string | null;
  /** A toggle's state, or `null` for a control that is not a toggle. */
  pressed: boolean | null;
  /** Classes beside Obsidian's own `clickable-icon`. */
  cls?: readonly string[];
  action: CreatePopupAction;
}

export interface CreatePopupRowInput {
  /** The armed tool, which a colour commits with; highlight where none is. */
  armed: MarkTool | null;
  colors: Readonly<Record<AnnotationTool, string>>;
  /** The swatches the row offers, in the order it draws them. */
  swatches: readonly string[];
  /** What this Attachment's Annotations may be edited to right now. */
  capability: EditingCapability;
  /** What the create in flight, if any, left on the selection. */
  mutation: MutationState;
  /** Whether the comment sheet stands open under the row. */
  commenting: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The create-mode row: the two tools, the swatches it is handed, the comment
 * sheet, and copy. A swatch keeps its seat in Zotero's palette as its id, so
 * `color-3` and the `3` key name the same colour whatever the row offers.
 *
 * Copying never changes Zotero, so it never stands down; every verb that
 * creates follows the same rule the Annotation Card's header does, because they
 * are the same write reached from another surface.
 */
export function createPopupRow({
  armed,
  colors,
  swatches,
  capability,
  mutation,
  commenting,
  now,
}: CreatePopupRowInput): readonly CreatePopupControl[] {
  const blocked = editingBlockedReason(capability, mutation, now);
  const tool = armed ?? "highlight";
  const creating = (
    control: Omit<CreatePopupControl, "disabled" | "tooltip"> & {
      label: string;
    },
  ): CreatePopupControl => ({
    ...control,
    tooltip: blocked ?? control.label,
    disabled: blocked !== null,
  });
  return [
    creating({
      id: "highlight",
      icon: "highlighter",
      label: m.pdf_toolbar_highlight(),
      action: { kind: "tool", tool: "highlight" },
      color: colors.highlight,
      pressed: armed === "highlight",
    }),
    creating({
      id: "underline",
      icon: "underline",
      label: m.pdf_toolbar_underline(),
      action: { kind: "tool", tool: "underline" },
      color: colors.underline,
      pressed: armed === "underline",
    }),
    ...swatches.map((hex) =>
      creating({
        id: `color-${ANNOTATION_COLORS.indexOf(hex) + 1}`,
        icon: "circle",
        label: annotationColorLabel(hex),
        action: { kind: "color", color: hex },
        color: hex,
        pressed: isColor(colors[tool], hex),
        // A swatch is a solid dot of its colour, not an outline.
        cls: ["zt:[&_svg]:fill-current"],
      }),
    ),
    creating({
      id: "comment",
      icon: "message-square-plus",
      label: m.annot_view_card_add_comment(),
      action: { kind: "comment" },
      color: null,
      pressed: commenting,
    }),
    {
      id: "copy",
      icon: "copy",
      tooltip: m.pdf_create_popup_copy(),
      disabled: false,
      color: null,
      pressed: null,
      action: { kind: "copy" },
    },
  ];
}

/** What a pressed control of the create-mode row runs. */
export type CreatePopupActivate = (
  action: CreatePopupAction,
  node: HTMLElement,
) => void;

/** Draws the create-mode row into the popup's content element. */
export function renderCreatePopupRow(
  row: HTMLElement,
  controls: readonly CreatePopupControl[],
  activate: CreatePopupActivate,
): void {
  row.empty();
  for (const control of controls) {
    markPopupControl(row, control, (pressed) =>
      activate(control.action, pressed),
    );
  }
}
