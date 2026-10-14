// A Query View toolbar button and the popover it opens, for a control a
// `Menu` cannot hold: a list of rows with dropdowns and drag handles. The
// popover is a native one in the top layer, so the platform owns showing it,
// the outside click and Escape; CSS anchor positioning places it under its
// button, as the Chooser does.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import type { IconName } from "obsidian";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Icon } from "@/components/obsidian/icon";
import { cn } from "@/lib/utils";

let popoverSequence = 0;

export interface ToolbarPopoverProps {
  icon: IconName;
  /** The button's name, shown beside its icon. */
  label: string;
  /** Whether the control holds a setting, which draws the button active. */
  active?: boolean;
  /** A `data-*` hook for the button and the popover. */
  hook: string;
  /** Called each time the popover opens. */
  onOpen?: () => void;
  /** Classes for the popover, after its own. */
  className?: string;
  children: ReactNode;
}

export function ToolbarPopover({
  icon,
  label,
  active,
  hook,
  onOpen,
  className,
  children,
}: ToolbarPopoverProps) {
  const [id] = useState(() => `zt-query-popover-${(popoverSequence += 1)}`);
  const [open, setOpen] = useState(false);
  const anchor = { "--zt-query-popover-anchor": `--${id}` } as CSSProperties;
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        data-query-toolbar={hook}
        className={cn(
          "clickable-icon zt:flex zt:items-center zt:gap-1 zt:[anchor-name:var(--zt-query-popover-anchor)]",
          (active || open) && "is-active",
        )}
        style={anchor}
      >
        <Icon name={icon} size={14} />
        <span>{label}</span>
      </button>
      <div
        id={id}
        popover="auto"
        data-query-popover={hook}
        onToggle={(event) => {
          setOpen(event.newState === "open");
          if (event.newState === "open") onOpen?.();
        }}
        className={cn(
          "zt:inset-auto zt:my-1 zt:max-h-[min(--spacing(120),calc(100%_-_--spacing(2)))] zt:max-w-110 zt:min-w-60 zt:flex-col zt:overflow-auto zt:p-(--menu-padding) zt:[&:popover-open]:flex",
          "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
          "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
          "zt:[position-anchor:var(--zt-query-popover-anchor)] zt:[position-area:block-end_span-inline-end] zt:[position-try-fallbacks:flip-block]",
          className,
        )}
        style={anchor}
      >
        {children}
      </div>
    </>
  );
}
