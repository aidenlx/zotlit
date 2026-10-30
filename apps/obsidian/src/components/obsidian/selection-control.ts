// The compact borderless selection control: an icon, or text and an icon, on
// the flat `clickable-icon` surface — shared by the Workbench view and the
// Annotation View.
import "./selection-control.css";
import { tv } from "@/lib/tw";
import { cn } from "@/lib/utils";

/** Icons beside 12 px regular text carry the same optical weight. */
export const captionIcon =
  "zt:[--icon-size:var(--icon-xs)] zt:[--icon-stroke:1.5]";
/** Every choose control shares the flat `clickable-icon` surface; `kind` sets its shape. */
export const selectionControl = tv({
  base: "clickable-icon",
  variants: {
    kind: {
      /** An icon-only action that sits beside a text trigger. */
      icon: cn("zt:shrink-0", captionIcon),
      /** A borderless text-and-icon control, subordinate to the result it changes. */
      trigger: cn(
        "zt-selection-trigger zt:max-w-full zt:min-w-0 zt:gap-1.5 zt:text-start zt:leading-normal zt:[&_svg]:shrink-0",
        captionIcon,
      ),
      /** A choice fills one row of the list that owns the corners around it. */
      option: "zt-selection-option zt:min-w-0 zt:[--clickable-icon-radius:0px]",
    },
  },
});
