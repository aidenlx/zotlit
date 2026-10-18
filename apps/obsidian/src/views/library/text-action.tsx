// A text action of the Library View: an action that reads as words beside
// other text, such as "Search all libraries", "Clear all" or "Show all
// libraries". It takes the accent, as a link does, so it reads as a control
// wherever it stands, and every one of them looks the same.
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Obsidian's unlayered `button` rules outrank utilities and draw a filled
 * button, so a text action is drawn on an element of its own with
 * `role="button"`.
 */
export const TEXT_ACTION_CLASS =
  "zt:inline-flex zt:cursor-(--cursor) zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:text-(--text-accent) zt:outline-hidden zt:hover:text-(--text-accent-hover) zt:hover:underline zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";

export function TextAction({
  onActivate,
  className,
  children,
  ...rest
}: {
  onActivate: () => void;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      {...rest}
      role="button"
      tabIndex={0}
      className={cn(TEXT_ACTION_CLASS, className)}
      onClick={onActivate}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate();
      }}
    >
      {children}
    </span>
  );
}
