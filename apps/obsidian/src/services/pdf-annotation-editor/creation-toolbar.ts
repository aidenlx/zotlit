// The Creation Toolbar: what the reader's own right toolbar slot offers, and
// the one function that draws it.
//
// The nodes are bare `clickable-icon` elements with layout utilities and no
// `.zt-root`, so no preflight reaches Obsidian's toolbar; the whole surface is
// vanilla DOM and every decision about it is data this module returns.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see https://github.com/aidenlx/zotlit/issues/1150
import type { IconName } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { IDLE } from "@/services/annotation-repository/write";
import { editingBlockedReason } from "@/views/annot-view/card-controls";

import { renderIconButton, updateIconButton } from "./icon-button";
import "./style.css";
import { MARK_TOOLS } from "./tools";
import type { MarkTool } from "./tools";

/** Layout only; Obsidian's `clickable-icon` owns the look of each control. */
const LAYOUT_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5"];

/**
 * The seat one tool's two halves share. They stretch to one height, and
 * `style.css` gives the seat the button's shape and its armed fill, so the pair
 * reads as one button while each half keeps `clickable-icon`'s own hover.
 */
const SPLIT_CLASSES = [themeHook.pdfTool, "zt:flex", "zt:items-stretch"];

/**
 * Every control the toolbar holds, in the order it draws them: two per tool —
 * the toggle that arms it and the chevron that opens its colours — and then
 * mark visibility.
 *
 * "Clear all annotations" is deliberately absent: the reader's toolbar offers
 * no verb that erases Annotations ZotLit did not create in this gesture.
 */
export type CreationToolbarControlId =
  | MarkTool
  | `${MarkTool}-color`
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
  /**
   * The tool whose split button this control is one half of — its toggle and
   * the chevron that opens its colours share a seat. `null` for a control that
   * stands on its own.
   */
  split: MarkTool | null;
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

/** Each tool's icon and the name it goes by, as Zotero's own reader names it. */
const TOOL_FACE: Record<MarkTool, { icon: IconName; label: () => string }> = {
  highlight: { icon: "highlighter", label: m.pdf_toolbar_highlight },
  underline: { icon: "underline", label: m.pdf_toolbar_underline },
  note: { icon: "sticky-note", label: m.pdf_toolbar_note },
  image: { icon: "square-dashed-mouse-pointer", label: m.pdf_toolbar_image },
  ink: { icon: "pencil", label: m.pdf_toolbar_ink },
};

/**
 * The toolbar as data. A control a capability block stands down keeps its seat
 * and carries the reason in its tooltip and its accessible state; mark
 * visibility changes nothing in Zotero, so it never stands down.
 *
 * The tools are a toggle group over what ZotLit writes today: one is armed at a
 * time, and arming the armed one stands it down again. Each tool is split in
 * two — the toggle wearing the tool's own colour, and a chevron opening that
 * colour's list — so a colour is chosen for the tool it belongs to whether or
 * not that tool is armed.
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
  const tool = (id: MarkTool): CreationToolbarControl[] => {
    const { icon, label } = TOOL_FACE[id];
    const name = label();
    const half = { disabled: blocked !== null, split: id };
    return [
      {
        ...half,
        id,
        icon,
        tooltip: blocked ?? name,
        pressed: armed === id,
        // The toggle wears the colour, so the tool on screen says which colour
        // it draws in without a swatch of its own.
        color: colors[id],
      },
      {
        ...half,
        id: `${id}-color`,
        icon: "chevron-down",
        tooltip: blocked ?? m.pdf_toolbar_tool_color({ tool: name }),
        pressed: null,
        // Left uncoloured: the chevron says a menu opens here, and the glyph
        // beside it is what shows the colour that menu is choosing.
        color: null,
      },
    ];
  };
  return [
    ...MARK_TOOLS.flatMap(tool),
    {
      id: "visibility",
      icon: marksVisible ? "eye" : "eye-off",
      tooltip: marksVisible
        ? m.pdf_toolbar_hide_marks()
        : m.pdf_toolbar_show_marks(),
      pressed: marksVisible,
      disabled: false,
      split: null,
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

/** Everything the toolbar builds once, and redraws its controls into. */
interface ToolbarShape extends CreationToolbarNodes {
  /** The tool toggle group, named by the hidden element beside it. */
  tools: HTMLElement;
  /** The controls that stand outside the group, which is mark visibility. */
  actions: HTMLElement;
}

/** Names one tool group apart from another reader's, for `aria-labelledby`. */
let groupSerial = 0;

/** The last model and handler each drawn toolbar took, by its root node. */
const drawn = new WeakMap<
  HTMLElement,
  {
    controls: ReadonlyMap<CreationToolbarControlId, CreationToolbarControl>;
    activate: CreationToolbarActivate;
  }
>();

/**
 * Draws the toolbar into the reader's right toolbar slot, building its nodes on
 * the first call and patching them in place on every call after — so a caller
 * redraws by calling again, once per state change, and a node under a pointer
 * that is still down outlives the redraw.
 *
 * A press is answered against the model the last call drew, so a control
 * stood down after its node was built takes no press.
 *
 * @param slot the reader's right toolbar slot.
 */
export function renderCreationToolbar(
  slot: HTMLElement,
  controls: readonly CreationToolbarControl[],
  activate: CreationToolbarActivate,
): CreationToolbarNodes {
  const shape = toolbarIn(slot) ?? createToolbar(slot);
  drawn.set(shape.root, {
    controls: new Map(controls.map((control) => [control.id, control])),
    activate,
  });
  const seats = new Map<MarkTool, HTMLElement>();

  for (const control of controls) {
    const node =
      shape.root.querySelector<HTMLElement>(`[data-zt-tool="${control.id}"]`) ??
      buildControl(shape, seats, control);
    updateIconButton(node, control);
    if (control.split === null) continue;
    // A split tool is one button, so the armed fill is the seat's and covers
    // both halves at once. Only the toggle reports the state, because only it
    // answers a press.
    node.removeClass("is-active");
    if (control.pressed !== null)
      node.parentElement?.toggleClass("is-active", control.pressed);
  }
  return { root: shape.root, capabilitySlot: shape.capabilitySlot };
}

/** One control's node, built live; its state is drawn by the caller. */
function buildControl(
  shape: ToolbarShape,
  seats: Map<MarkTool, HTMLElement>,
  { id, icon, tooltip, split }: CreationToolbarControl,
): HTMLElement {
  const node = renderIconButton(
    seatFor(shape, seats, split),
    { icon, tooltip },
    (pressed) => {
      const last = drawn.get(shape.root);
      if (last?.controls.get(id)?.disabled === false)
        last.activate(id, pressed);
    },
  );
  node.dataset.ztTool = id;
  return node;
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

/**
 * Where one control is drawn: the seat its tool's two halves share, built on
 * the first half to ask for it, or the row a control that stands alone takes.
 */
function seatFor(
  shape: ToolbarShape,
  seats: Map<MarkTool, HTMLElement>,
  split: MarkTool | null,
): HTMLElement {
  if (split === null) return shape.actions;
  const seat =
    seats.get(split) ?? shape.tools.createDiv({ cls: SPLIT_CLASSES });
  seats.set(split, seat);
  return seat;
}

function toolbarIn(slot: HTMLElement): ToolbarShape | null {
  const root = slot.querySelector<HTMLElement>(
    `:scope > .${themeHook.pdfCreationToolbar}`,
  );
  if (!root) return null;
  const [, tools, actions, capabilitySlot] = root.children;
  return tools?.instanceOf(HTMLElement) &&
    actions?.instanceOf(HTMLElement) &&
    capabilitySlot?.instanceOf(HTMLElement)
    ? { root, tools, actions, capabilitySlot }
    : null;
}

function createToolbar(slot: HTMLElement): ToolbarShape {
  const root = slot.createDiv({
    cls: [
      themeHook.pdfCreationToolbar,
      ...LAYOUT_CLASSES,
      "zt:flex-wrap",
      "zt:min-w-0",
    ],
  });
  // The group's name is a hidden element rather than an `aria-label`, so it
  // reaches assistive technology without hanging a tooltip over the gaps
  // between the tools. @see apps/obsidian/policies/tooltips.md
  const label = root.createSpan({
    cls: "zt:sr-only",
    text: m.pdf_toolbar_tools(),
    attr: { id: `zt-pdf-tool-group-${++groupSerial}` },
  });
  const tools = root.createDiv({
    cls: LAYOUT_CLASSES,
    attr: { role: "group", "aria-labelledby": label.id },
  });
  const actions = root.createDiv({ cls: LAYOUT_CLASSES });
  const capabilitySlot = root.createDiv({ cls: LAYOUT_CLASSES });
  return { root, tools, actions, capabilitySlot };
}
