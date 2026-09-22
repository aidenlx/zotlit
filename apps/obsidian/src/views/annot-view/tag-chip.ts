// Shared variant recipe for the annotation view's tag data chips (card + bar + drawer).

import { tv } from "@/lib/tw";

/**
 * One look for every tag data chip in the view, driven by Obsidian's `--tag-*`
 * theme tokens so all surfaces read as native tags. Avoids Obsidian's `.tag`
 * class (unlayered — forces `!important`, and only styles `a.tag`).
 * - `state` — resting native tag (with `--tag-*-hover`), `selected` (vault accent,
 *   signalling an active filter), or `disabled` (zero-hit: dimmed, non-interactive).
 * - `density` — orthogonal to color: `dense` for the drawer cloud, else the tag's
 *   own padding. Both take the view's own `text-xs` step rather than
 *   `--tag-size`: the chip is filter-bar chrome, and the count and the
 *   vocabulary trigger beside it are on that step.
 * - `truncate` — clips a long name so the bar's first chip fits one line.
 */
export const tagChipVariants = tv({
  base: "zt:rounded-(--tag-radius) zt:border-(length:--tag-border-width) zt:font-(--tag-weight) zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:motion-safe:transition-colors",
  variants: {
    state: {
      resting:
        "zt:cursor-pointer zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:text-(color:--tag-color) zt:hover:border-(--tag-border-color-hover) zt:hover:bg-(--tag-background-hover) zt:hover:text-(color:--tag-color-hover)",
      selected:
        "zt:cursor-pointer zt:border-primary zt:bg-primary zt:text-primary-foreground",
      disabled:
        "zt:cursor-default zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:text-(color:--tag-color) zt:opacity-40",
    },
    density: {
      comfortable: "zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:text-xs",
      dense: "zt:px-2 zt:py-px zt:text-xs",
    },
    truncate: {
      true: "zt:min-w-0 zt:shrink",
      false: "zt:shrink-0",
    },
  },
  defaultVariants: {
    state: "resting",
    density: "comfortable",
    truncate: false,
  },
});
