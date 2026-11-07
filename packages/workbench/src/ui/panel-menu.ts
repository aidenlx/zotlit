// The menu path to every panel size, for a reader who cannot drag a handle
// (WCAG 2.5.7): one menu per handle the view draws, each with entries to grow,
// shrink and reset its panel. Each host draws them in its own menu: the
// Obsidian view's pane menu, the web Workbench's View menu.

import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchModel } from "./model";
import { canResizePanel, panelHandles, resizePanel } from "./panel-layout";
import type {
  PanelBounds,
  PanelHandle,
  PanelResize,
  WorkbenchPanels,
} from "./panel-layout";

export interface PanelSizeItem {
  /** The handle whose panel the entry sizes. */
  readonly handle: PanelHandle;
  readonly resize: PanelResize;
  readonly label: string;
  /** The entry would change nothing: the panel is at its limit or default. */
  readonly disabled: boolean;
  readonly apply: (panels: WorkbenchPanels) => WorkbenchPanels;
}

export interface PanelSizeMenu {
  readonly handle: PanelHandle;
  /** The way the handle moves: a column edge sideways, the split up and down. */
  readonly axis: "horizontal" | "vertical";
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
    const axis = handle === "split" ? "vertical" : "horizontal";
    const labels =
      axis === "vertical"
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
      axis,
      label: m.workbench_preview_resize(),
      items: RESIZES.map((resize) => ({
        handle,
        resize,
        label: labels[resize],
        disabled: !canResizePanel(handle, resize, bounds)(panels),
        apply: resizePanel(handle, resize, bounds),
      })),
    };
  });
}

/**
 * Applies a size menu entry, and has the panels announce the size it gives,
 * as the handle's own value is read while the reader moves it.
 */
export function pickPanelSize(
  registry: AtomRegistry.AtomRegistry,
  model: Pick<WorkbenchModel, "panels" | "sizedFromMenu">,
  item: PanelSizeItem,
): void {
  registry.update(model.panels, item.apply);
  registry.set(model.sizedFromMenu, item.handle);
}
