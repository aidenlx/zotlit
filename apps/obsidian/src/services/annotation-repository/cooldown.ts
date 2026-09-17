// The clock every surface counts Zotero's dialog rate limit down on.
//
// A cooldown is the one capability whose copy changes with no event behind it,
// so each surface showing it redraws on a timer. The cadence and the timer are
// stated here once, for the settings row and for the Annotation View's
// affordance alike.

/** How often a surface redraws while Zotero's dialog rate limit runs. */
export const COUNTDOWN_INTERVAL = Temporal.Duration.from({ seconds: 1 });

/**
 * Ticks once a second on one window until the returned function is called.
 *
 * The window is the caller's, not the global one: a surface that pops out keeps
 * its timer on the window that draws it.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function countdownInterval(win: Window, tick: () => void): () => void {
  const id = win.setInterval(tick, COUNTDOWN_INTERVAL.total("milliseconds"));
  return () => win.clearInterval(id);
}
