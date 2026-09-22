import { clsx } from "cn";
import type { ClassValue } from "cn";
import type { TooltipOptions } from "obsidian";
import type { KeyboardEvent, MouseEvent } from "react";

import { twMerge } from "@/lib/tw";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface TooltipAttrs {
  "aria-label": string;
  "data-tooltip-position"?: NonNullable<TooltipOptions["placement"]>;
  "data-tooltip-classes"?: string;
  "data-tooltip-delay"?: number;
}

/**
 * Pure equivalent of Obsidian's `setTooltip(el, text, opts)`: returns the
 * attributes the global `pointerover` delegation reads. Spread onto any
 * element to opt into Obsidian's hover tooltip without an imperative ref
 * effect.
 * @param text Tooltip text; stored as `aria-label`.
 * @param options Maps to `data-tooltip-position` / `-classes` / `-delay`.
 * @see {@link TooltipOptions}
 */
export function tooltipAttrs(
  text: string,
  options?: TooltipOptions,
): TooltipAttrs {
  const attrs: TooltipAttrs = { "aria-label": text };
  if (options?.placement && options.placement !== "bottom") {
    attrs["data-tooltip-position"] = options.placement;
  }
  if (options?.classes?.length) {
    attrs["data-tooltip-classes"] = options.classes.join(" ");
  }
  if (options?.delay) {
    attrs["data-tooltip-delay"] = options.delay;
  }
  return attrs;
}

/**
 * Enter/Space activates a `role="button"` element the way a native `<button>`
 * would. {@link activatable} is the React half; a vanilla `keydown` listener
 * calls this directly, which is why the event is read structurally rather than
 * as one framework's shape.
 */
export function onActivateKey(
  e: Pick<KeyboardEvent, "key" | "preventDefault">,
  activate: () => void,
) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    activate();
  }
}

/**
 * Accessible-button behavior for a non-`<button>` element: adds `role="button"`,
 * focusability, and click/Enter/Space activation with propagation stopped so a
 * parent handler never double-fires. Spread onto the element; supply
 * `aria-pressed`/`aria-expanded`, className, and content at the call site.
 * @param activate Runs on click and on Enter/Space.
 * @param options `disabled` drops it from the tab order and blocks activation.
 */
export function activatable(
  activate: () => void,
  { disabled }: { disabled?: boolean } = {},
) {
  return {
    role: "button" as const,
    tabIndex: disabled ? -1 : 0,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      activate();
    },
    onKeyDown: (e: KeyboardEvent) => {
      e.stopPropagation();
      if (disabled) return;
      onActivateKey(e, activate);
    },
  };
}

/** The clicks a control has already answered, keyed by the event itself. */
const claimedClicks = new WeakSet<Event>();

/**
 * Claim a click for the control it landed on, so an ancestor that acts on the
 * same click stands down.
 *
 * Halting the click would stand the ancestor down too, but Obsidian dismisses
 * an open `Menu` from a `click` listener on the window: a click that never
 * reaches the window leaves the menu standing, and the trigger that opened it
 * can never shut it.
 *
 * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
 */
export function claimClick(e: { nativeEvent: Event }): void {
  claimedClicks.add(e.nativeEvent);
}

/** Whether a control has already answered this click. */
export function clickClaimed(e: { nativeEvent: Event }): boolean {
  return claimedClicks.has(e.nativeEvent);
}
