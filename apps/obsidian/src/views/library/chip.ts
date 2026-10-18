// The chip of a filter in the Library Tree: a Reading State facet or a tag of
// the Tag Selector, so the two read as one family. Selected, it takes the
// accent, as `aria-pressed` says.

/**
 * Obsidian's unlayered `button` rules outrank the chip's utilities, so a chip
 * is drawn on an element of its own with `role="button"`.
 */
export const FILTER_CHIP_CLASS =
  "zt:cursor-(--cursor) zt:rounded-(--radius-l) zt:border-(length:--border-width) zt:border-(--background-modifier-border) zt:px-(--size-4-2) zt:py-(--size-2-1) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:outline-hidden zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:aria-pressed:border-(--interactive-accent) zt:aria-pressed:bg-(--interactive-accent) zt:aria-pressed:text-(--text-on-accent) zt:aria-pressed:hover:bg-(--interactive-accent-hover) zt:aria-pressed:hover:text-(--text-on-accent)";
