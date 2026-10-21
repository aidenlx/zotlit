// What a top-layer popover that holds an expression editor shares with the
// others: the Chooser popup and the Query View toolbar popovers.

/**
 * The root of a popover an editor draws its tooltips in. The popover
 * user-agent rule makes the root a scroll box, which would cut a tooltip off
 * at the popover's edge; this root does not clip, and its contents scroll in
 * boxes of their own instead.
 */
export const tooltipHostRoot = "zt:overflow-visible";
