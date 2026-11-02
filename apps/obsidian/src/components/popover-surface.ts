// What a top-layer popover that holds an expression editor shares with the
// others: the Chooser popup and the Query View toolbar popovers.

/**
 * The root of a popover an editor draws its tooltips in. The popover
 * user-agent rule makes the root a scroll box, which would cut a tooltip off
 * at the popover's edge; this root does not clip, and its contents scroll in
 * boxes of their own instead.
 */
export const tooltipHostRoot = "zt:overflow-visible";

/**
 * Raises Obsidian's tooltips over `popover` until the returned function runs.
 * Obsidian appends each tooltip to the window's body, which paints under the
 * top layer at any z-index, so a tooltip of a control in the popover falls
 * behind it. Each tooltip becomes a manual popover: it enters the top layer
 * after `popover`, leaves `popover` open, and leaves with its element.
 * Obsidian has set the tooltip's place by the time the observer runs; the
 * classes clear what the user-agent popover rule adds to that box.
 */
export function raiseTooltips(popover: HTMLElement): () => void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!node.instanceOf(HTMLElement)) continue;
        if (!node.isConnected || !node.hasClass("tooltip")) continue;
        node.addClasses(raisedTooltipClasses);
        node.popover = "manual";
        node.showPopover();
      }
    }
  });
  observer.observe(popover.doc.body, { childList: true });
  return () => observer.disconnect();
}

const raisedTooltipClasses = [
  "zt:m-0",
  "zt:border-0",
  "zt:overflow-visible",
  "zt:bottom-auto",
  "zt:right-auto",
];
