// Obsidian's hover popover with each timer cancelled on the window that armed
// it, and placed in the window it opened in.
import { HoverPopover, PopoverState } from "obsidian";

/**
 * Obsidian arms the show timer and the hide timer on `activeWindow` and
 * cancels each with the main window's `clearTimeout`. While a popout owns
 * focus those are two windows with separate timer tables, so the cancel
 * misses: a popover hidden before its delay opens again, unloaded and empty,
 * and one re-entered during its off-target grace closes at the stale
 * deadline. Every popover of the plugin extends this class, which cancels a
 * timer on the window that armed it. Verified against Obsidian 1.14.1.
 */
export class PopoutAwareHoverPopover extends HoverPopover {
  /** The window `timer` was armed on: `activeWindow` at the time. */
  #timerWindow: Window = activeWindow;

  override transition(): void {
    const { state, timer } = this;
    super.transition();
    if (this.timer !== timer) this.#timerWindow = activeWindow;
    else if (state === PopoverState.Hiding && this.state === PopoverState.Shown)
      this.#timerWindow.clearTimeout(timer);
  }

  /**
   * The document a popover with no target stands in, such as the document of
   * the view it hangs over. `null` keeps it in the document of its first
   * placement.
   */
  protected homeDocument(): Document | null {
    return null;
  }

  /**
   * Obsidian places a popover with no target in `activeDocument` on every
   * call, so a placement while another window holds focus carries the popover
   * there. A popover with no target stands in its home document instead. One
   * with a target stands in the target's document already. Verified against
   * Obsidian 1.14.5.
   */
  override position(): void {
    const owner = this.targetEl
      ? null
      : (this.homeDocument() ?? this.hoverEl.parentElement?.doc);
    if (!owner || owner === activeDocument) {
      super.position();
      return;
    }
    const focused = activeDocument;
    activeDocument = owner;
    try {
      super.position();
    } finally {
      activeDocument = focused;
    }
  }

  override hide(): void {
    this.#timerWindow.clearTimeout(this.timer);
    super.hide();
  }

  /**
   * Show now instead of after the wait. Obsidian's global click handler hides
   * every popover still waiting to show, focused or not, so a popover opened
   * on a pointer release would meet that release's own `click` and never show.
   * Verified against Obsidian 1.14.2.
   */
  showNow(): void {
    this.#timerWindow.clearTimeout(this.timer);
    this.show();
  }
}
