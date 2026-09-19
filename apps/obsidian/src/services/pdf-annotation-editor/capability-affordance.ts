// The Editing Capability inside Obsidian's PDF reader: what its toolbar draws,
// and which keystroke counts as an edit gesture the block has to answer for.
//
// The node is a bare `clickable-icon` with layout utilities and no `.zt-root`,
// so no preflight reaches Obsidian's own toolbar, and the whole surface is
// vanilla DOM — the Annotation View renders the same copy table in Preact.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
import { setIcon, setTooltip } from "obsidian";

import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";

import { renderIconButton } from "./icon-button";

/** Layout only; Obsidian's `clickable-icon` owns the rest of the look. */
const LAYOUT_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-1"];

/**
 * The reader's edit keymap, and the one place it is written down: the two mark
 * tools, the comment sheet, and the eight colours. The creation surfaces
 * (aidenlx/zotlit#1150) take this set rather than declaring a second one, so
 * the keys that create a mark and the keys that explain why one cannot be
 * created can never diverge.
 */
const EDIT_GESTURE_KEYS = new Set([
  "h",
  "u",
  "c",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
]);

export interface CapabilityAffordanceProps {
  capability: EditingCapability;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
  /** The click: a Capability Probe, then the "Zotero editing" settings row. */
  onActivate: () => void;
}

/**
 * Draws the enable-editing affordance into the reader's right toolbar slot,
 * building its node on the first call and rewriting the contents on every call
 * after. Removes it when normal editing controls are available.
 *
 * @param slot the reader's right toolbar slot.
 * @returns the node it drew, so a caller can read back what is on screen.
 */
export function renderCapabilityAffordance(
  slot: HTMLElement,
  { capability, now, onActivate }: CapabilityAffordanceProps,
): HTMLElement | null {
  const affordance = editingCapabilityAffordance(capability, now);
  if (affordance === null) {
    removeCapabilityAffordance(slot);
    return null;
  }
  const { icon, tone, tooltip, label, spinning, countdown } = affordance;
  // The button is built with the state it is about to show, and redrawn by
  // replacing the text beside Obsidian's icon.
  const held = affordanceIn(slot);
  const node =
    held ??
    renderIconButton(
      slot,
      {
        icon,
        tooltip,
        cls: [themeHook.pdfCapability, ...LAYOUT_CLASSES],
      },
      onActivate,
    );

  node.dataset.ztCapabilityTone = tone;
  node.classList.toggle("mod-warning", tone === "warning");
  if (spinning) node.setAttribute("aria-busy", "true");
  else node.removeAttribute("aria-busy");

  if (held) {
    setTooltip(node, tooltip);
    node
      .querySelectorAll(
        "[data-zt-capability-label], [data-zt-capability-countdown]",
      )
      .forEach((child) => child.remove());
    setIcon(node, icon);
  }
  if (spinning) node.querySelector("svg")?.classList.add("zt:animate-spin");
  node.createSpan({
    text: label,
    attr: { "data-zt-capability-label": "" },
  });
  if (countdown !== null) {
    node.createSpan({
      cls: "zt:text-xs zt:tabular-nums",
      text: String(countdown),
      attr: { "data-zt-capability-countdown": "" },
    });
  }
  return node;
}

/**
 * Leaves the toolbar as Obsidian built it. Idempotent: a slot that never held
 * the affordance, and one it has already been taken out of, both answer the
 * same — which is what lets the binding's disposer run after Obsidian's own
 * `empty()` has already cleared the toolbar.
 */
export function removeCapabilityAffordance(slot: HTMLElement): void {
  affordanceIn(slot)?.remove();
}

/**
 * Whether a keystroke in the reader asked to edit the document — the shared
 * reading of {@link EDIT_GESTURE_KEYS}, for the creation surfaces that act on
 * one as much as for the block that has to explain itself.
 *
 * Modified keys belong to Obsidian's own commands, and a keystroke inside a
 * text field belongs to the field, so neither is an edit gesture.
 *
 * @param event a keydown from anywhere inside the PDF view.
 */
export function isEditGesture(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!EDIT_GESTURE_KEYS.has(event.key.toLowerCase())) return false;
  return !inTextEntry(event.target);
}

/** The affordance this slot holds, or null while it holds none. */
function affordanceIn(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(
    `:scope > .${themeHook.pdfCapability}`,
  );
}

/**
 * Whether a keystroke landed in something that takes typing — the one reading
 * every reader keymap is inert against.
 *
 * `instanceOf` rather than `instanceof`: the reader runs in pop-out windows,
 * where a global DOM constructor belongs to the wrong window.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function inTextEntry(target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (!node?.instanceOf(HTMLElement)) return false;
  return (
    node.instanceOf(HTMLInputElement) ||
    node.instanceOf(HTMLTextAreaElement) ||
    node.instanceOf(HTMLSelectElement) ||
    node.isContentEditable
  );
}
