// Obsidian's hover popover, placed in the window it opened in and able to show
// without its wait.
import { HoverPopover as ObsidianHoverPopover } from "obsidian";

/** Every popover of the plugin extends this class. */
export class HoverPopover extends ObsidianHoverPopover {
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
   * Obsidian 1.15.1.
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

  /**
   * Show now instead of after the wait. Obsidian's global click handler hides
   * every popover still waiting to show, focused or not, so a popover opened
   * on a pointer release would meet that release's own `click` and never show.
   * Obsidian arms the wait on the main window. Verified against Obsidian
   * 1.15.1.
   */
  showNow(): void {
    // oxlint-disable-next-line zotlit-obsidian/no-global-timer -- Obsidian arms the wait on the main window.
    window.clearTimeout(this.timer);
    this.show();
  }
}
