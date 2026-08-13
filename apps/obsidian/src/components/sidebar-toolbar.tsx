// The fixed action header a sidebar view carries above its content: the toolbar shell and its action group.

import type { HTMLAttributes, Ref } from "react";

import { cn } from "@/lib/utils";

export interface SidebarToolbarProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/**
 * The toolbar shell: a flex line carrying the header padding every sidebar view
 * shares. Each view keeps its own container queries, wrapping, and trailing
 * content — statistics, selectors, breakpoints — by passing them through
 * `className` and children.
 */
export function SidebarToolbar({
  className,
  ref,
  ...rest
}: SidebarToolbarProps) {
  return (
    <div ref={ref} {...rest} className={cn("zt:flex zt:p-2", className)} />
  );
}

/**
 * The action group: the view's icon buttons, centered and wrapping the way the
 * native header centers actions that stand alone.
 */
function Actions({ className, ref, ...rest }: SidebarToolbarProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        "zt:flex zt:flex-wrap zt:justify-center zt:gap-0.5",
        className,
      )}
    />
  );
}

SidebarToolbar.Actions = Actions;
