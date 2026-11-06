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

import { panelSizeMenus, showPanel } from "@zotlit/workbench/ui";
import type { PanelSide, WorkbenchModel } from "@zotlit/workbench/ui";

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
  model: Pick<WorkbenchModel, "panels" | "panelDefaults" | "viewSize">;
  registry: AtomRegistry.AtomRegistry;
}) {
  const panels = useAtomValue(model.panels);
  const size = useAtomValue(model.viewSize);
  const show = (side: PanelSide, shown: boolean) =>
    registry.update(model.panels, showPanel(side, shown));
  const menus = panelSizeMenus(m, panels, {
    size,
    defaults: model.panelDefaults,
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
        <PanelsTopLeft aria-hidden />
        {m.workbench_view_menu()}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="xs">
        <DropdownMenuCheckboxItem
          checked={panels.fields.shown}
          onCheckedChange={(shown) => show("fields", shown)}
        >
          {m.workbench_show_fields()}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={panels.preview.shown}
          onCheckedChange={(shown) => show("preview", shown)}
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
                    onClick={() => registry.update(model.panels, item.apply)}
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
