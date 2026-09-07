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

/** Enter/Space activates a `role="button"` element the way a native `<button>` would. */
function onActivateKey(e: KeyboardEvent, activate: () => void) {
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
