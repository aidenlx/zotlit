// The menu path to every panel size, for a reader who cannot drag a handle
// (WCAG 2.5.7): one menu per handle the view draws, each with entries to grow,
// shrink and reset its panel. Each host draws them in its own menu: the
// Obsidian view's pane menu, the web Workbench's View menu.

import type { WorkbenchMessages } from "./generated/messages";
import { canResizePanel, panelHandles, resizePanel } from "./panel-layout";
import type {
  PanelBounds,
  PanelHandle,
  PanelResize,
  WorkbenchPanels,
} from "./panel-layout";

export interface PanelSizeItem {
  readonly resize: PanelResize;
  readonly label: string;
  /** The entry would change nothing: the panel is at its limit or default. */
  readonly disabled: boolean;
  readonly apply: (panels: WorkbenchPanels) => WorkbenchPanels;
}

export interface PanelSizeMenu {
  readonly handle: PanelHandle;
  /** The handle's own name, so the menu reads as the handle does. */
  readonly label: string;
  readonly items: readonly PanelSizeItem[];
}

const RESIZES: readonly PanelResize[] = ["grow", "shrink", "reset"];

/** The size menus for the handles the view draws for `panels`. */
export function panelSizeMenus(
  m: WorkbenchMessages,
  panels: WorkbenchPanels,
  bounds: PanelBounds,
): readonly PanelSizeMenu[] {
  return panelHandles(panels, bounds.size).map((handle) => {
    const labels =
      handle === "split"
        ? {
            grow: m.workbench_panel_taller(),
            shrink: m.workbench_panel_shorter(),
            reset: m.workbench_panel_reset_height(),
          }
        : {
            grow: m.workbench_panel_wider(),
            shrink: m.workbench_panel_narrower(),
            reset: m.workbench_panel_reset_width(),
          };
    return {
      handle,
      label:
        handle === "fields"
          ? m.workbench_fields_resize()
          : m.workbench_preview_resize(),
      items: RESIZES.map((resize) => ({
        resize,
        label: labels[resize],
        disabled: !canResizePanel(handle, resize, bounds)(panels),
        apply: resizePanel(handle, resize, bounds),
      })),
    };
  });
}
