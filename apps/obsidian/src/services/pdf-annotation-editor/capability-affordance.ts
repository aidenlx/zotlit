// The Editing Capability inside Obsidian's PDF reader: what its toolbar draws,
// and which keystroke counts as an edit gesture the block has to answer for.
//
// The status uses layout utilities without `.zt-root`, so preflight stays
// outside Obsidian's toolbar. The Annotation View renders the same copy in Preact.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
import { setIcon } from "obsidian";

import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";

/** Aligns the status icon and text within the native toolbar. */
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
}

/**
 * Draws the pending-authorization status into the reader's right toolbar slot,
 * building its node on the first call and rewriting the contents on every call
 * after. Removes it when normal editing controls are available.
 *
 * @param slot the reader's right toolbar slot.
 * @returns the node it drew, so a caller can read back what is on screen.
 */
export function renderCapabilityAffordance(
  slot: HTMLElement,
  { capability, now }: CapabilityAffordanceProps,
): HTMLElement | null {
  // Authorization is offered in the Annotation View and settings.
  const affordance =
    capability.kind === "authorizing" || capability.kind === "cooldown"
      ? editingCapabilityAffordance(capability, now)
      : null;
  if (affordance === null) {
    removeCapabilityAffordance(slot);
    return null;
  }
  const { icon, tone, label, spinning, countdown } = affordance;
  // The status is built with the state it is about to show, and redrawn by
  // replacing the text beside Obsidian's icon.
  const held = affordanceIn(slot);
  const node =
    held ??
    slot.createDiv({
      cls: [
        themeHook.pdfCapability,
        ...LAYOUT_CLASSES,
        "zt:text-muted-foreground",
      ],
      attr: { role: "status" },
    });
  if (!held) setIcon(node, icon);
  node.dataset.ztCapabilityTone = tone;
  node.classList.toggle("mod-warning", tone === "warning");
  if (spinning) node.setAttribute("aria-busy", "true");
  else node.removeAttribute("aria-busy");

  if (held) {
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
