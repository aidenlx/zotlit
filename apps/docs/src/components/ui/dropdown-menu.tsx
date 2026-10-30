// shadcn Base UI Dropdown Menu. Match the editor's Hover Card surface.
// @see https://ui.shadcn.com/docs/components/base/dropdown-menu
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

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

export function DropdownMenuItem({
  className,
  ...props
}: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex min-h-10 cursor-default items-center gap-2 rounded-sm px-3 py-2 text-sm leading-normal break-words group-data-[size=xs]/menu:min-h-8 group-data-[size=xs]/menu:gap-1.5 group-data-[size=xs]/menu:px-2 group-data-[size=xs]/menu:py-1 group-data-[size=xs]/menu:text-xs data-highlighted:bg-fd-muted data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 group-data-[size=xs]/menu:[&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
