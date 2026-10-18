// The chip of a filter in the Library Tree: a Reading State facet or a tag of
// the Tag Selector, so the two read as one family. Selected, it takes the
// accent, as `aria-pressed` says. A tag is drawn as this one chip wherever
// the Library View shows it: in the Tag Selector and on the Reading Card.

/**
 * Obsidian's unlayered `button` rules outrank the chip's utilities, so a chip
 * is drawn on an element of its own with `role="button"`.
 */
export const FILTER_CHIP_CLASS =
  "zt:cursor-(--cursor) zt:rounded-(--radius-l) zt:border-(length:--border-width) zt:border-(--background-modifier-border) zt:px-(--size-4-2) zt:py-(--size-2-1) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:outline-hidden zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:aria-pressed:border-(--interactive-accent) zt:aria-pressed:bg-(--interactive-accent) zt:aria-pressed:text-(--text-on-accent) zt:aria-pressed:hover:bg-(--interactive-accent-hover) zt:aria-pressed:hover:text-(--text-on-accent)";

/** A tag's chip: a filter chip that wraps a long name rather than overflow. */
export const TAG_CHIP_CLASS = `${FILTER_CHIP_CLASS} zt:max-w-full zt:[overflow-wrap:anywhere]`;

/**
 * The height of one line of filter chips, its text line, padding and
 * border, at the chip's type size: an icon beside a line of them centres on
 * it.
 */
export const FILTER_CHIP_LINE_CLASS =
  "zt:h-[calc(1lh+2*var(--size-2-1)+2*var(--border-width))] zt:text-(length:--font-ui-smaller)";
