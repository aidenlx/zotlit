// A Query View toolbar button and the popover it opens, for a control a
// `Menu` cannot hold: a list of rows with dropdowns and drag handles. The
// popover is a native one in the top layer, so the platform owns showing it,
// the outside click and Escape; CSS anchor positioning places it under its
// button, as the Chooser does.
//
// The shell is modelled on the Bases toolbar menu, and draws it from the same
// variables: the `--menu-*` surface, sections split by a rule, a section
// header, and text-style action rows ("+ Add sort") in a footer section.
//
// Shell parts, for a popover's contents to compose (pass `composed` so the
// shell adds no padding of its own):
// - `PopoverSection` — one block of the popover. Sections stack with a rule
//   between them, as Bases splits "Sort by" from its "Add sort" footer.
// - `PopoverHeader` — a section's title, such as "Sort by". Takes trailing
//   content (a count, a button) after the title.
// - `PopoverRow` — a row of a section: icon, name and trailing controls, with
//   the hover fill of a Bases menu row. Pass `onClick` to make it a button.
// - `PopoverActions` — the footer section that holds the action rows.
// - `PopoverAction` — an action row: a muted icon and a text label, such as
//   "Add sort" with `icon="plus"`.
// - `PopoverDivider` — a rule inside a section, for a split that is not
//   between two sections.
// - `toolbarPopoverClass` — the surface classes, for a popover another
//   component owns, such as the Results menu.
// - `popoverFallbacks` — the placement fallbacks alone, for a Chooser popup
//   that hangs from the toolbar.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import type { IconName } from "obsidian";
import { useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";

import { Icon } from "@/components/obsidian/icon";
import { cn } from "@/lib/utils";

import { ToolbarButton } from "./toolbar-button";

let popoverSequence = 0;

/**
 * The surface of a toolbar popover: Obsidian's menu, from the `--menu-*`
 * variables a Bases toolbar menu reads. It has no padding: its sections pad
 * themselves. Placement reads `--zt-query-popover-anchor`; it opens under its
 * button, starting at the button's start edge, and flips to the other side
 * of either axis where the window has no room.
 */
/**
 * Where a popover goes when the window has no room under its button: above
 * it, or ending at the button's end edge, as a control near the pane's right
 * edge needs.
 */
export const popoverFallbacks =
  "zt:[position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline]";

export const toolbarPopoverClass = cn(
  "zt:inset-auto zt:my-1 zt:max-h-[min(--spacing(120),calc(100%_-_--spacing(2)))] zt:max-w-[min(--spacing(110),100vw)] zt:min-w-55 zt:flex-col zt:overflow-auto zt:p-0 zt:[&:popover-open]:flex",
  "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow) zt:[backdrop-filter:var(--menu-backdrop-filter)]",
  "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
  "zt:[position-anchor:var(--zt-query-popover-anchor)] zt:[position-area:block-end_span-inline-end]",
  popoverFallbacks,
);

export interface ToolbarPopoverProps {
  icon: IconName;
  /** The button's name, shown beside its icon and as its tooltip. */
  label: string;
  /** Whether the control holds a setting, which draws the button active. */
  active?: boolean;
  /** How many settings the control holds, shown as the button's badge. */
  count?: number;
  /** A `data-*` hook for the button and the popover. */
  hook: string;
  /** Called each time the popover opens. */
  onOpen?: () => void;
  /**
   * The children are built from the shell parts, which pad themselves. Without
   * it the shell pads its children by `--menu-padding`.
   */
  composed?: boolean;
  /** Classes for the popover, after its own. */
  className?: string;
  children: ReactNode;
}

export function ToolbarPopover({
  icon,
  label,
  active,
  count,
  hook,
  onOpen,
  composed,
  className,
  children,
}: ToolbarPopoverProps) {
  const [id] = useState(() => `zt-query-popover-${(popoverSequence += 1)}`);
  const [open, setOpen] = useState(false);
  const anchor = { "--zt-query-popover-anchor": `--${id}` } as CSSProperties;
  return (
    <>
      <ToolbarButton
        icon={icon}
        label={label}
        active={active}
        count={count}
        open={open}
        popoverTarget={id}
        aria-expanded={open}
        data-query-toolbar={hook}
        className="zt:[anchor-name:var(--zt-query-popover-anchor)]"
        style={anchor}
      />
      <div
        id={id}
        popover="auto"
        data-query-popover={hook}
        onToggle={(event) => {
          setOpen(event.newState === "open");
          if (event.newState === "open") onOpen?.();
        }}
        className={cn(
          toolbarPopoverClass,
          !composed && "zt:p-(--menu-padding)",
          className,
        )}
        style={anchor}
      >
        {children}
      </div>
    </>
  );
}

/** One block of a popover; a rule splits it from the next. */
export function PopoverSection({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cn(
        "zt:flex zt:flex-col zt:p-(--size-2-1) zt:not-last:border-b-(length:--border-width) zt:not-last:border-border",
        className,
      )}
    />
  );
}

/** A section's title, such as "Sort by"; trailing content follows it. */
export function PopoverHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-query-popover-header=""
      {...rest}
      className={cn(
        "zt:flex zt:items-center zt:gap-(--size-4-1) zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-sm zt:[font-weight:var(--font-medium)] zt:text-foreground",
        className,
      )}
    />
  );
}

const rowClass =
  "zt:flex zt:w-full zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:[corner-shape:var(--corner-shape)] zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-start zt:text-sm zt:text-foreground zt:hover:bg-muted";

/** A row of a section, as a Bases menu row draws it. */
export function PopoverRow({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn(rowClass, className)} />;
}

/** The footer section of a popover, which holds its action rows. */
export function PopoverActions({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <PopoverSection
      data-query-popover-actions=""
      {...rest}
      className={cn("zt:p-(--size-4-1)", className)}
    />
  );
}

export interface PopoverActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  ref?: Ref<HTMLButtonElement>;
  [data: `data-${string}`]: string | undefined;
}

/**
 * An action row: a muted icon and a text label, such as "Add sort". It stays
 * a bare `<button>`, its Obsidian button box rolled back as the toolbar
 * button's is, so it reads as a menu row rather than a button.
 */
export function PopoverAction({
  icon,
  className,
  children,
  ...rest
}: PopoverActionProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "zt-query-popover-action zt:cursor-(--cursor)",
        rowClass,
        className,
      )}
    >
      <Icon
        name={icon}
        size="var(--icon-s)"
        strokeWidth="var(--icon-s-stroke-width)"
        className="zt:shrink-0 zt:text-muted-foreground"
      />
      <span className="zt:truncate">{children}</span>
    </button>
  );
}

/** A rule inside a section, as Obsidian's `.menu-separator` draws it. */
export function PopoverDivider({ className }: { className?: string }) {
  return (
    <div
      role="separator"
      data-query-popover-divider=""
      className={cn(
        "zt:my-(--size-2-1) zt:border-b-(length:--border-width) zt:border-border",
        className,
      )}
    />
  );
}
