// The side panels beside the editor: what the reader chose to show and how
// wide or tall, and where each shown panel goes in a view of a given size.
// The choice is saved state; the placement is derived from it and the view
// size and never saved, so resizing a view changes only the placement.

import { patchAt } from "./patch";

/** The side panels beside the editor: Fields at the leading edge, Preview at the trailing edge. */
export type PanelSide = "fields" | "preview";
export interface WorkbenchPanel {
  readonly shown: boolean;
  /** The panel's width in pixels, which the reader sets with its edge. */
  readonly width: number;
}
export interface PreviewPanel extends WorkbenchPanel {
  /**
   * The share of the view height, in percent, the Preview takes while it
   * stands under the editor.
   */
  readonly height: number;
}
export interface WorkbenchPanels {
  readonly fields: WorkbenchPanel;
  readonly preview: PreviewPanel;
}

/** The widths a panel can take, in pixels. */
export const PANEL_WIDTH = { min: 240, initial: 400, max: 960 } as const;

/** The shares of the view height the Preview takes under the editor, in percent. */
export const PREVIEW_HEIGHT = { min: 20, initial: 40, max: 80 } as const;

/**
 * The least room the editor keeps beside and above the panels, in pixels.
 * The height holds the editor's toolbar and tab rows, the tab's one-line
 * task, and five lines of source; a host draws the source at least five
 * lines tall and scrolls the tab when its content needs more.
 */
export const EDITOR_MIN = { width: 360, height: 320 } as const;

/** A new editor shows neither panel. */
export const INITIAL_PANELS: WorkbenchPanels = {
  fields: { shown: false, width: PANEL_WIDTH.initial },
  preview: {
    shown: false,
    width: PANEL_WIDTH.initial,
    height: PREVIEW_HEIGHT.initial,
  },
};

/**
 * The share of the panels' container one panel takes at most, so the source
 * stays in view. A host draws the same share in CSS, such as a `max-w-2/5`
 * class on the panel.
 */
const PANEL_SHARE = 0.4;

/**
 * `width` held within {@link PANEL_WIDTH}, and within `max` where the host
 * draws the panel narrower than that.
 */
export const clampPanelWidth = (width: number, max: number = PANEL_WIDTH.max) =>
  Math.round(
    Math.min(Math.max(PANEL_WIDTH.min, max), Math.max(PANEL_WIDTH.min, width)),
  );

/**
 * The widest a host draws a panel in a container `container` pixels wide:
 * {@link PANEL_SHARE} of it, and never past {@link PANEL_WIDTH}.
 */
export const panelLimit = (container: number) =>
  clampPanelWidth(container * PANEL_SHARE);

/** `share` held within {@link PREVIEW_HEIGHT}. */
export const clampPreviewHeight = (share: number) =>
  Math.round(Math.min(PREVIEW_HEIGHT.max, Math.max(PREVIEW_HEIGHT.min, share)));

export const showPanel = (side: PanelSide, shown: boolean) =>
  patchAt<WorkbenchPanels, PanelSide>(side, { shown });
/** Sets a panel's width, held within {@link PANEL_WIDTH}. */
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchAt<WorkbenchPanels, PanelSide>(side, { width: clampPanelWidth(width) });
/** Sets the Preview's share of the view height, held within {@link PREVIEW_HEIGHT}. */
export const setPreviewHeight = (share: number) =>
  patchAt<WorkbenchPanels, "preview">("preview", {
    height: clampPreviewHeight(share),
  });

/** The size of the view the panels and the editor share, in pixels. */
export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where each panel goes. The Preview stands beside the editor, under it, or
 * nowhere while it is hidden. `fields` says where the Fields Panel goes
 * whether it shows or not, so the Fields action knows what it opens: a column
 * beside the editor, or a popover over it.
 */
export interface PanelPlacement {
  readonly preview: "side" | "below" | "hidden";
  readonly fields: "column" | "popover";
}

/**
 * Places the panels in a view of `size`; a view not measured yet places them
 * as columns. A panel is a column only while the editor keeps
 * {@link EDITOR_MIN} beside it, and the Preview claims the side before the
 * Fields Panel.
 */
export function placePanels(
  panels: WorkbenchPanels,
  size: ViewSize | null,
): PanelPlacement {
  if (size === null)
    return {
      preview: panels.preview.shown ? "side" : "hidden",
      fields: "column",
    };
  const drawn = (panel: WorkbenchPanel) =>
    clampPanelWidth(panel.width, panelLimit(size.width));
  let room = size.width;
  let preview: PanelPlacement["preview"] = "hidden";
  if (panels.preview.shown) {
    const width = drawn(panels.preview);
    if (room - width >= EDITOR_MIN.width) {
      preview = "side";
      room -= width;
    } else preview = "below";
  }
  return {
    preview,
    fields:
      room - drawn(panels.fields) >= EDITOR_MIN.width ? "column" : "popover",
  };
}

/**
 * The Preview's height under the editor, in pixels: its `share` of a view
 * `viewHeight` pixels tall, less whatever the editor needs to keep
 * {@link EDITOR_MIN}. The Preview gives up height before the editor does.
 */
export const previewBelowHeight = (share: number, viewHeight: number) =>
  Math.max(
    0,
    Math.min(
      Math.round((viewHeight * share) / 100),
      viewHeight - EDITOR_MIN.height,
    ),
  );
