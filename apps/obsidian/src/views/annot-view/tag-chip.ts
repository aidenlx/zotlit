// Shared variant recipe for the annotation view's tag data chips (card + bar + drawer).

import { tv } from "@/lib/tw";

/**
 * One look for every tag data chip in the view, driven by Obsidian's `--tag-*`
 * theme tokens so all surfaces read as native tags. Avoids Obsidian's `.tag`
 * class (unlayered — forces `!important`, and only styles `a.tag`).
 * - `state` — resting native tag (with `--tag-*-hover`), `selected` (vault accent,
 *   signalling an active filter), or `disabled` (zero-hit: dimmed, non-interactive).
 * - `density` — orthogonal to color: `dense` for the drawer cloud (~11px), else the
 *   tag's own padding/size.
 * - `truncate` — clips a long name so the bar's first chip fits one line.
 * - `ring` — the card chip adds an accent ring when selected (compound with `state`)
 *   to echo the card's own selected outline; the bar/drawer chips stay flat.
 */
export const tagChipVariants = tv({
  base: "zt:rounded-(--tag-radius) zt:border-(length:--tag-border-width) zt:leading-none zt:font-(--tag-weight) zt:motion-safe:transition-colors",
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
      comfortable:
        "zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:text-(length:--tag-size)",
      dense: "zt:px-2 zt:py-px zt:text-[11px]",
    },
    truncate: {
      true: "zt:min-w-0 zt:shrink",
      false: "zt:shrink-0",
    },
    ring: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { state: "selected", ring: true, class: "zt:ring-1 zt:ring-primary" },
  ],
  defaultVariants: {
    state: "resting",
    density: "comfortable",
    truncate: false,
    ring: false,
  },
});
