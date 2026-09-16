// The Creation Toolbar: what the reader's own right toolbar slot offers, and
// the one function that draws it.
//
// The nodes are bare `clickable-icon` elements with layout utilities and no
// `.zt-root`, so no preflight reaches Obsidian's toolbar; the whole surface is
// vanilla DOM and every decision about it is data this module returns.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see https://github.com/aidenlx/zotlit/issues/1150
import { setIcon, setTooltip } from "obsidian";
import type { IconName } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import { onActivateKey } from "@/lib/utils";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { IDLE } from "@/services/annotation-repository/write";
import { editingBlockedReason } from "@/views/annot-view/card-controls";

import "./style.css";

/** Layout only; Obsidian's `clickable-icon` owns the look of each control. */
const LAYOUT_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5"];

/** The two marks ZotLit creates. Underline is a peer of highlight throughout. */
export type MarkTool = "highlight" | "underline";

export const MARK_TOOLS: readonly MarkTool[] = ["highlight", "underline"];

/**
 * Every control the toolbar holds, in the order it draws them.
 *
 * "Clear all annotations" is deliberately absent: the reader's toolbar offers
 * no verb that erases Annotations ZotLit did not create in this gesture.
 */
export type CreationToolbarControlId =
  | MarkTool
  | "highlight-color"
  | "underline-color"
  | "visibility";

/** One control, decided as data so nothing about it is settled in the DOM. */
export interface CreationToolbarControl {
  id: CreationToolbarControlId;
  icon: IconName;
  /** The accessible name, which Obsidian also renders as the hover tooltip. */
  tooltip: string;
  /** A toggle's state, or `null` for a control that is not a toggle. */
  pressed: boolean | null;
  disabled: boolean;
  /** The swatch this control wears, or `null` for one that wears none. */
  color: string | null;
}

export interface CreationToolbarProps {
  /** The tool a released selection commits with, or `null` while none is armed. */
  armed: MarkTool | null;
  /** Each tool's own colour, which the Mark Popup writes back into. */
  colors: Readonly<Record<MarkTool, string>>;
  /** Whether the Annotation Marks are drawn over the pages. */
  marksVisible: boolean;
  /** What this Attachment's Annotations may be edited to right now. */
  capability: EditingCapability;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The toolbar as data. A control that cannot write keeps its seat and carries
 * the reason in its tooltip and its accessible state; mark visibility changes
 * nothing in Zotero, so it never stands down.
 *
 * @see apps/obsidian/policies/tooltips.md
 */
export function creationToolbar({
  armed,
  colors,
  marksVisible,
  capability,
  now,
}: CreationToolbarProps): readonly CreationToolbarControl[] {
  const blocked = editingBlockedReason(capability, IDLE, now);
  const tool = (
    id: MarkTool,
    icon: IconName,
    label: string,
  ): CreationToolbarControl => ({
    id,
    icon,
    tooltip: blocked ?? label,
    pressed: armed === id,
    disabled: blocked !== null,
    color: colors[id],
  });
  const swatch = (
    id: "highlight-color" | "underline-color",
    of: MarkTool,
    label: string,
  ): CreationToolbarControl => ({
    id,
    icon: "circle",
    tooltip: blocked ?? label,
    pressed: null,
    disabled: blocked !== null,
    color: colors[of],
  });
  return [
    tool("highlight", "highlighter", m.pdf_toolbar_highlight()),
    swatch("highlight-color", "highlight", m.pdf_toolbar_highlight_color()),
    tool("underline", "underline", m.pdf_toolbar_underline()),
    swatch("underline-color", "underline", m.pdf_toolbar_underline_color()),
    {
      id: "visibility",
      icon: marksVisible ? "eye" : "eye-off",
      tooltip: marksVisible
        ? m.pdf_toolbar_hide_marks()
        : m.pdf_toolbar_show_marks(),
      pressed: marksVisible,
      disabled: false,
      color: null,
    },
  ];
}

/** What a pressed control runs, against the node pressed. */
export type CreationToolbarActivate = (
  id: CreationToolbarControlId,
  node: HTMLElement,
) => void;

/** The two mounts the toolbar hands back to its caller. */
export interface CreationToolbarNodes {
  root: HTMLElement;
  /**
   * Where the Editing Capability affordance is drawn, which the toolbar builds
   * once and never rewrites, so the affordance's own renderer owns it.
   */
  capabilitySlot: HTMLElement;
}

/**
 * Draws the toolbar into the reader's right toolbar slot, building its nodes on
 * the first call and rewriting the controls on every call after — so a caller
 * redraws by calling again, once per state change.
 *
 * @param slot the reader's right toolbar slot.
 */
export function renderCreationToolbar(
  slot: HTMLElement,
  controls: readonly CreationToolbarControl[],
  activate: CreationToolbarActivate,
): CreationToolbarNodes {
  const nodes = toolbarIn(slot) ?? createToolbar(slot);
  const [row] = nodes.root.children;
  if (!row?.instanceOf(HTMLElement)) return nodes;

  row.empty();
  for (const control of controls) {
    const node = row.createDiv({
      cls: "clickable-icon",
      attr: { role: "button", tabindex: "0" },
    });
    node.dataset.ztTool = control.id;
    setTooltip(node, control.tooltip);
    setIcon(node, control.icon);
    // Through the element's own style rather than an attribute on the icon's
    // SVG, where a stylesheet's rules would be out of reach and `var()` would
    // not substitute at all.
    if (control.color !== null) node.style.color = control.color;
    if (control.pressed !== null) {
      node.classList.toggle("is-active", control.pressed);
      node.setAttribute("aria-pressed", String(control.pressed));
    }
    if (control.disabled) {
      node.addClass("is-disabled");
      node.setAttribute("aria-disabled", "true");
      continue;
    }
    node.addEventListener("click", () => activate(control.id, node));
    node.addEventListener("keydown", (event) =>
      onActivateKey(event, () => activate(control.id, node)),
    );
  }
  return nodes;
}

/**
 * Leaves the toolbar as Obsidian built it. Idempotent: a slot that never held
 * the Creation Toolbar, and one it has already been taken out of, both answer
 * the same — which is what lets the binding's disposer run after Obsidian's own
 * `empty()` has already cleared the toolbar.
 */
export function removeCreationToolbar(slot: HTMLElement): void {
  toolbarIn(slot)?.root.remove();
}

function toolbarIn(slot: HTMLElement): CreationToolbarNodes | null {
  const root = slot.querySelector<HTMLElement>(
    `:scope > .${themeHook.pdfCreationToolbar}`,
  );
  const capabilitySlot = root?.lastElementChild;
  return root && capabilitySlot?.instanceOf(HTMLElement)
    ? { root, capabilitySlot }
    : null;
}

function createToolbar(slot: HTMLElement): CreationToolbarNodes {
  const root = slot.createDiv({
    cls: [themeHook.pdfCreationToolbar, ...LAYOUT_CLASSES],
  });
  root.createDiv({ cls: LAYOUT_CLASSES });
  const capabilitySlot = root.createDiv({ cls: LAYOUT_CLASSES });
  return { root, capabilitySlot };
}
