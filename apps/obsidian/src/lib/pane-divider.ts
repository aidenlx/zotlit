// The divider a reader drags to size a pane inside a view, drawn as
// Obsidian draws the divider between its own panes and sidebars
// (`.workspace-leaf-resize-handle`): a strip `--divider-width-hover` wide on
// a pane's edge, over the pane, whose one line of `--divider-width` on the
// edge's outer side is all it shows until the pointer finds it. Hover and
// keyboard focus fill the strip with `--divider-color-hover`; a drag holds it
// in the accent wherever the pointer leaves it. The strip takes no room of its own beyond that line.
//
// A drag marks the divider with the `is-active` class, as Obsidian's own
// does, or with `data-dragging` where a React tree draws it.
import { tv } from "@/lib/tw";

/**
 * The classes of a pane divider. `edge` is the pane's edge the divider sits
 * on, whose outer side draws its line.
 *
 * `flow` says how it takes no room. `overlay` places it inside a positioned
 * pane, over that edge, as a sidebar's divider stands inside the sidebar.
 * `inline` makes it the flex item after the pane before it, as Obsidian's
 * divider between two split panes stands on the earlier pane's end or
 * bottom edge: it reaches back over that pane by all of the strip but its
 * line.
 */
export const paneDivider = tv({
  base: [
    "zt:z-(--layer-cover) zt:shrink-0 zt:touch-none zt:outline-none zt:select-none",
    "zt:border-(--divider-color) zt:bg-transparent",
    "zt:transition-[background-color,border-color,opacity] zt:duration-200 zt:ease-[ease-in-out]",
    "zt:hover:border-(--divider-color-hover) zt:hover:bg-(--divider-color-hover)",
    "zt:focus-visible:border-(--divider-color-hover) zt:focus-visible:bg-(--divider-color-hover)",
    // Obsidian's hover rule follows its drag rule, so the strip under the
    // pointer keeps the hover colour while it is dragged.
    "zt:[&.is-active:not(:hover),&[data-dragging]:not(:hover)]:border-(--color-accent) zt:[&.is-active:not(:hover),&[data-dragging]:not(:hover)]:bg-(--color-accent)",
  ],
  variants: {
    edge: {
      start:
        "zt:w-(--divider-width-hover) zt:cursor-col-resize zt:border-s-(length:--divider-width)",
      end: "zt:w-(--divider-width-hover) zt:cursor-col-resize zt:border-e-(length:--divider-width)",
      top: "zt:h-(--divider-width-hover) zt:cursor-row-resize zt:border-t-(length:--divider-width)",
      bottom:
        "zt:h-(--divider-width-hover) zt:cursor-row-resize zt:border-b-(length:--divider-width)",
    },
    flow: {
      overlay: "zt:absolute",
      inline: "zt:relative",
    },
  },
  compoundVariants: [
    { flow: "overlay", edge: "start", class: "zt:inset-y-0 zt:start-0" },
    { flow: "overlay", edge: "end", class: "zt:inset-y-0 zt:end-0" },
    { flow: "overlay", edge: "top", class: "zt:inset-x-0 zt:top-0" },
    { flow: "overlay", edge: "bottom", class: "zt:inset-x-0 zt:bottom-0" },
    {
      flow: "inline",
      edge: "end",
      class: "zt:ms-[calc(var(--divider-width)-var(--divider-width-hover))]",
    },
    {
      flow: "inline",
      edge: "bottom",
      class: "zt:mt-[calc(var(--divider-width)-var(--divider-width-hover))]",
    },
  ],
});
