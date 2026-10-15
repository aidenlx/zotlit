// The Query View toolbar button: an icon, a name, an optional chevron and an
// optional count badge, as the Bases toolbar lays them out. It is ZotLit's
// own control, drawn only by `zt:` utilities over Obsidian's variables, so a
// theme that restyles Obsidian's buttons and Bases restyles it too. States are
// `data-*` presence attributes: `data-active` (the control holds a setting,
// drawn in the accent ink) and `data-open` (its popover stands).
//
// The toolbar is a size container: below its breakpoint a button shows its
// icon only, and its name shows as the tooltip. The view switcher and the
// result count keep their text, as in Bases.
//
// Exports:
// - `ToolbarButton` — a bare `<button>` with the content below.
// - `ToolbarButtonContent` — the icon, name, chevron and badge, for a trigger
//   another component renders, such as `Chooser.Trigger`.
// - `toolbarButtonClass` — the class list for such a trigger.
//
// @see ./toolbar-button.css
import type { IconName } from "obsidian";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { Icon } from "@/components/obsidian/icon";
import { themeHook } from "@/lib/theme-hooks";
import { cn, tooltipAttrs } from "@/lib/utils";

import "./toolbar-button.css";

/**
 * The class list of a toolbar button. Colour, radius, font size and the hover
 * fill all read Obsidian's variables — the ones its `.text-icon-button` reads.
 */
export const toolbarButtonClass = cn(
  themeHook.queryToolbarButton,
  "zt:inline-flex zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:p-(--size-2-2) zt:whitespace-nowrap",
  "zt:cursor-(--cursor) zt:rounded-(--button-radius) zt:text-sm zt:[font-weight:var(--input-font-weight)] zt:text-muted-foreground zt:[corner-shape:var(--button-corner-shape)]",
  // An active button keeps the accent ink while hovered or open, and takes
  // the accent hover fill, as an active `.text-icon-button` does.
  "zt:hover:bg-muted zt:not-data-active:hover:text-foreground zt:data-open:bg-muted zt:not-data-active:data-open:text-foreground",
  "zt:data-active:text-(--icon-color-active) zt:data-active:hover:bg-accent zt:data-active:data-open:bg-accent",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
);

/** A toolbar button's name: hidden on a narrow toolbar unless `keep` is set. */
const labelClass = (keep?: boolean) =>
  cn("zt:truncate zt:pe-(--size-2-1)", !keep && "zt:hidden zt:@xl:inline");

export interface ToolbarButtonContentProps {
  icon?: IconName;
  /** The button's name, beside its icon. A string is its tooltip too. */
  label: ReactNode;
  /** Keep the name on a narrow toolbar, as the view switcher does. */
  keepLabel?: boolean;
  /** Classes for the name, after its own. */
  labelClassName?: string;
  /** Draw a chevron after the name, for a switcher. */
  chevron?: boolean;
  /** How many settings the control holds; nothing shows for none. */
  count?: number;
}

export function ToolbarButtonContent({
  icon,
  label,
  keepLabel,
  labelClassName,
  chevron,
  count,
}: ToolbarButtonContentProps) {
  return (
    <>
      {icon && (
        <Icon
          name={icon}
          size="var(--icon-s)"
          strokeWidth="var(--icon-s-stroke-width)"
          className="zt:shrink-0"
        />
      )}
      <span className={cn(labelClass(keepLabel), labelClassName)}>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          data-query-badge={count}
          className="zt:hidden zt:pe-(--size-2-1) zt:text-xs zt:opacity-60 zt:@xl:inline"
        >
          {count}
        </span>
      )}
      {chevron && (
        <Icon
          name="chevrons-up-down"
          size="var(--icon-xs)"
          strokeWidth="var(--icon-xs-stroke-width)"
          className="zt:ms-auto zt:shrink-0 zt:text-muted-foreground"
        />
      )}
    </>
  );
}

export interface ToolbarButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    ToolbarButtonContentProps {
  /** The control holds a setting: the accent ink. */
  active?: boolean;
  /** The control's popover stands. */
  open?: boolean;
  ref?: Ref<HTMLButtonElement>;
  [data: `data-${string}`]: string | undefined;
}

export function ToolbarButton({
  icon,
  label,
  keepLabel,
  labelClassName,
  chevron,
  count,
  active,
  open,
  className,
  ...rest
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      {...(typeof label === "string" ? tooltipAttrs(label) : {})}
      data-active={active ? "" : undefined}
      data-open={open ? "" : undefined}
      {...rest}
      className={cn(toolbarButtonClass, className)}
    >
      <ToolbarButtonContent
        icon={icon}
        label={label}
        keepLabel={keepLabel}
        labelClassName={labelClassName}
        chevron={chevron}
        count={count}
      />
    </button>
  );
}
