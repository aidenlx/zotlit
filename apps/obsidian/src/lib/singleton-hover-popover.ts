// Re-targets one native hover popover across a group of DOM targets.
import { HoverPopover } from "obsidian";

/**
 * `targetEl` is read live by native consumers; its two constructor-bound
 * mouse listeners must move with it. `transition()` restores Hiding to Shown
 * and clears the hide timer, while Showing keeps its original enter timer.
 * Consumers own content and anchoring: `staticPos` is read on every
 * `position()`. Position after rendering each swap because `watchResize`
 * disconnects itself after ten callbacks.
 *
 * A port must declare five runtime members (verified in Obsidian 1.13.7):
 * mutable `targetEl`, `onTarget`, `onMouseIn`, `onMouseOut`, and `transition()`.
 *
 * @see https://github.com/aidenlx/zotlit/blob/fbcff12fa/docs/research/hover-popover-singleton.md
 */
export class SingletonHoverPopover extends HoverPopover {
  retarget(target: HTMLElement): void {
    this.targetEl?.removeEventListener("mouseover", this.onMouseIn);
    this.targetEl?.removeEventListener("mouseout", this.onMouseOut);
    this.targetEl = target;
    target.addEventListener("mouseover", this.onMouseIn);
    target.addEventListener("mouseout", this.onMouseOut);
    this.onTarget = true;
    this.transition();
  }
}
