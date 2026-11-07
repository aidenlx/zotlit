// shadcn Base UI Dropdown Menu. Match the editor's Hover Card surface.
// @see https://ui.shadcn.com/docs/components/base/dropdown-menu
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({
  align = "start",
  sideOffset = 6,
  anchor,
  className,
  size = "default",
  ...props
}: MenuPrimitive.Popup.Props & { size?: "default" | "xs" } & Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "sideOffset" | "anchor"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50"
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-size={size}
          className={cn(
            "group/menu max-h-(--available-height) max-w-[calc(100vw-2rem)] min-w-56 overflow-y-auto rounded-lg bg-fd-popover p-1 text-sm text-fd-popover-foreground shadow-lg ring-1 ring-fd-border data-[size=xs]:min-w-44 data-[size=xs]:text-xs",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

const ITEM =
  "relative flex min-h-10 cursor-default items-center gap-2 rounded-sm px-3 py-2 text-sm leading-normal break-words group-data-[size=xs]/menu:min-h-8 group-data-[size=xs]/menu:gap-1.5 group-data-[size=xs]/menu:px-2 group-data-[size=xs]/menu:py-1 group-data-[size=xs]/menu:text-xs data-highlighted:bg-fd-muted data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 group-data-[size=xs]/menu:[&_svg]:size-3.5";

export function DropdownMenuItem({
  className,
  ...props
}: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(ITEM, className)}
      {...props}
    />
  );
}

/** An entry that opens a page, as a link the browser handles. */
export function DropdownMenuLinkItem({
  className,
  ...props
}: MenuPrimitive.LinkItem.Props) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="dropdown-menu-link-item"
      className={cn(ITEM, className)}
      {...props}
    />
  );
}

/** A choice the reader turns on and off; a check in the icon slot shows it on. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(ITEM, className)}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center group-data-[size=xs]/menu:size-3.5">
        <MenuPrimitive.CheckboxItemIndicator>
          <Check aria-hidden />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuGroupLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-group-label"
      className={cn(
        "px-3 pt-2 pb-1 text-xs font-medium text-fd-muted-foreground group-data-[size=xs]/menu:px-2",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-fd-border", className)}
      {...props}
    />
  );
}
