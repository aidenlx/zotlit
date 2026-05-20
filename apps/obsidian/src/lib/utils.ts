import { type ClassValue, clsx } from "clsx";
import type { TooltipOptions } from "obsidian";
import { twMerge } from "tailwind-merge";

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
