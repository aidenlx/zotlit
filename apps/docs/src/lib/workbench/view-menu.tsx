// The web Workbench's View menu, the twin of the Obsidian view's pane menu:
// which side panels show, and the size of each panel the frame draws, so a
// reader who cannot drag a handle sizes it from here (WCAG 2.5.7).
import { useAtomValue } from "@effect/atom-react";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  ChevronDown,
  FoldHorizontal,
  FoldVertical,
  PanelsTopLeft,
  RotateCcw,
  UnfoldHorizontal,
  UnfoldVertical,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  panelSizeMenus,
  pickPanelSize,
  pressFieldsAction,
  showPanel,
} from "@zotlit/workbench/ui";
import type { WorkbenchModel } from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { m } from "@/paraglide/messages.js";

const ICONS = {
  horizontal: { grow: UnfoldHorizontal, shrink: FoldHorizontal },
  vertical: { grow: UnfoldVertical, shrink: FoldVertical },
};

export function ViewMenu({
  model,
  registry,
}: {
  model: Pick<
    WorkbenchModel,
    "panels" | "panelDefaults" | "viewSize" | "fieldsAction" | "sizedFromMenu"
  >;
  registry: AtomRegistry.AtomRegistry;
}) {
  const panels = useAtomValue(model.panels);
  const size = useAtomValue(model.viewSize);
  const fieldsAction = useAtomValue(model.fieldsAction);
  // Show fields presses the Fields action. Where that opens the Fields
  // popover, the menu closes first and the popover opens once the menu has
  // handed focus back, so the popover keeps the focus it takes.
  const opensFields = useRef(false);
  const menus = panelSizeMenus(m, panels, {
    size,
    defaults: model.panelDefaults,
  });
  // The menu stays open across size steps, so the reader takes step after
  // step. A step that moves a panel to another place changes which handles
  // the view draws, and with them the groups below: the entries would move
  // under the pointer. The menu closes then, on the new layout.
  const [open, setOpen] = useState(false);
  const handles = menus.map(({ handle }) => handle).join(" ");
  const [drawn, setDrawn] = useState(handles);
  if (drawn !== handles) {
    setDrawn(handles);
    if (open) setOpen(false);
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) opensFields.current = false;
        setOpen(next);
      }}
      onOpenChangeComplete={(open) => {
        if (!open && opensFields.current) pressFieldsAction(registry, model);
      }}
    >
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
        <PanelsTopLeft aria-hidden />
        {m.workbench_view_menu()}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        size="xs"
        // Focus goes to the popover the entry opens, not back to View.
        finalFocus={() => !opensFields.current}
      >
        <DropdownMenuCheckboxItem
          checked={fieldsAction.open}
          closeOnClick
          onCheckedChange={() => {
            if (fieldsAction.open) pressFieldsAction(registry, model);
            else opensFields.current = true;
          }}
        >
          {m.workbench_show_fields()}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={panels.preview.shown}
          onCheckedChange={(shown) =>
            registry.update(model.panels, showPanel("preview", shown))
          }
        >
          {m.workbench_show_preview()}
        </DropdownMenuCheckboxItem>
        {menus.map(({ handle, axis, label, items }) => {
          const icons = ICONS[axis];
          return [
            <DropdownMenuSeparator key={`${handle}-separator`} />,
            <DropdownMenuGroup key={handle}>
              <DropdownMenuGroupLabel>{label}</DropdownMenuGroupLabel>
              {items.map((item) => {
                const Icon =
                  item.resize === "reset" ? RotateCcw : icons[item.resize];
                return (
                  <DropdownMenuItem
                    key={item.resize}
                    disabled={item.disabled}
                    // The menu stays open, so the reader takes step after
                    // step and sees the panel change behind it.
                    closeOnClick={false}
                    onClick={() => pickPanelSize(registry, model, item)}
                  >
                    <Icon aria-hidden />
                    {item.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>,
          ];
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
