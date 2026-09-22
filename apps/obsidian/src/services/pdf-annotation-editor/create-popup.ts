// The Mark Popup in create mode: the row a settled text selection offers, and
// the comment sheet it opens under that row.
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
import { themeHook } from "@/lib/theme-hooks";
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
  action: CreatePopupAction;
}

export interface CreatePopupRowInput {
  /** The armed tool, which a colour commits with; highlight where none is. */
  armed: MarkTool | null;
  colors: Readonly<Record<AnnotationTool, string>>;
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
 * The create-mode row: the two tools, Zotero's eight colours, the comment
 * sheet, and copy.
 *
 * Copying never changes Zotero, so it never stands down; every verb that
 * creates follows the same rule the Annotation Card's header does, because they
 * are the same write reached from another surface.
 */
export function createPopupRow({
  armed,
  colors,
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
    ...ANNOTATION_COLORS.map((hex, index) =>
      creating({
        id: `color-${index + 1}`,
        icon: "circle",
        label: annotationColorLabel(hex),
        action: { kind: "color", color: hex },
        color: hex,
        pressed: isColor(colors[tool], hex),
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
    const node = markPopupControl(row, control, (pressed) =>
      activate(control.action, pressed),
    );
    if (control.pressed === null) continue;
    node.classList.toggle("is-active", control.pressed);
    node.setAttribute("aria-pressed", String(control.pressed));
  }
}

export interface CommentSheetProps {
  /** What the editor opens with. */
  value: string;
  /** Saves the comment and creates the Annotation. */
  onSave: (comment: string) => void;
  /** Steps back one level, leaving the selection and the row standing. */
  onCancel: () => void;
  /** The caller binds Mod+Enter through its owning native Scope. */
  nativeSubmit?: boolean;
  readOnly?: boolean;
}

/**
 * The optional comment sheet, under the create-mode row. `Ctrl+Enter`
 * (Windows) or `Command+Enter` (macOS) saves and `Escape` steps back; the
 * reader's own keymap is inert inside the editor, so both are bound here.
 *
 * @param sheet the element the editor is drawn into, replacing what it held.
 */
export function renderCommentSheet(
  sheet: HTMLElement,
  {
    value,
    onSave,
    onCancel,
    nativeSubmit = false,
    readOnly = false,
  }: CommentSheetProps,
): HTMLTextAreaElement {
  sheet.empty();
  sheet.addClass(themeHook.pdfCommentSheet);
  const editor = sheet.createEl("textarea", {
    cls: ["zt:w-full", "zt:resize-none"],
    attr: {
      rows: "3",
      placeholder: m.annot_view_card_comment_placeholder(),
      "aria-label": m.annot_view_card_add_comment(),
    },
  });
  editor.value = value;
  editor.readOnly = readOnly;
  if (!nativeSubmit)
    sheet.createDiv({
      cls: ["zt:text-xs", "zt:text-muted-foreground"],
      text: readOnly
        ? m.annot_view_comment_paused()
        : m.pdf_create_popup_comment_hint(),
    });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (
      nativeSubmit ||
      event.key !== "Enter" ||
      !(event.metaKey || event.ctrlKey)
    ) {
      return;
    }
    event.preventDefault();
    if (!editor.readOnly) onSave(editor.value);
  });
  return editor;
}
