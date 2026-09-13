// Obsidian's hover popover with each timer cancelled on the window that armed it.
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

  override hide(): void {
    this.#timerWindow.clearTimeout(this.timer);
    super.hide();
  }
}
