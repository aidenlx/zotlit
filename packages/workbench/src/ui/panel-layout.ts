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
 * stays in view. The panels draw each column at the width this share leaves
 * it, through the host's width custom property, so the hosts' CSS holds no
 * share of its own.
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
  /**
   * The width the host draws each column's handle at, between the column and
   * the editor; a column takes it from the editor's room too. None where the
   * host draws its handles over the panels.
   */
  readonly handle?: number;
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

/** The Fields picker standing open, with the search it opened on. */
export interface FieldsPicker {
  /** The key the reader opened it with from the Fields action, or nothing. */
  readonly query: string;
}

/** What the Fields action opens in the view as it is now, and whether that is open. */
export interface FieldsAction {
  readonly opens: PanelPlacement["fields"];
  readonly open: boolean;
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
  // Each column takes its handle's width with its own.
  const taken = (panel: WorkbenchPanel) => drawn(panel) + (size.handle ?? 0);
  let room = size.width;
  let preview: PanelPlacement["preview"] = "hidden";
  if (panels.preview.shown) {
    const width = taken(panels.preview);
    if (room - width >= EDITOR_MIN.width) {
      preview = "side";
      room -= width;
    } else preview = "below";
  }
  return {
    preview,
    fields:
      room - taken(panels.fields) >= EDITOR_MIN.width ? "column" : "popover",
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

/**
 * The handles that size the panels: the edge of the Fields column, the edge
 * of the Preview column, and the split over the Preview under the editor.
 */
export type PanelHandle = "fields" | "preview" | "split";
/** What a menu entry or a double-click does to a handle's panel. */
export type PanelResize = "grow" | "shrink" | "reset";

/**
 * How far one key press moves a handle: an edge by `width` pixels, or by
 * `wideWidth` with Shift, and the split by `height` percent of the view.
 */
export const KEY_STEP = { width: 16, wideWidth: 64, height: 5 } as const;

/**
 * How far one menu entry moves a handle: the Shift+arrow step of an edge,
 * and two arrow steps of the split.
 */
const MENU_STEP = {
  width: KEY_STEP.wideWidth,
  height: KEY_STEP.height * 2,
} as const;

/** Whether `side` shows as a column beside the editor in `placement`. */
const isColumn = (
  panels: WorkbenchPanels,
  placement: PanelPlacement,
  side: PanelSide,
) =>
  side === "fields"
    ? panels.fields.shown && placement.fields === "column"
    : placement.preview === "side";

/** The handles a view of `size` draws for `panels`, in document order. */
export function panelHandles(
  panels: WorkbenchPanels,
  size: ViewSize | null,
): readonly PanelHandle[] {
  const placement = placePanels(panels, size);
  const handles: PanelHandle[] = [];
  if (isColumn(panels, placement, "fields")) handles.push("fields");
  if (isColumn(panels, placement, "preview")) handles.push("preview");
  if (placement.preview === "below") handles.push("split");
  return handles;
}

/** The widest a host draws a panel in a view of `size`. */
const drawnLimit = (size: ViewSize | null) =>
  size ? panelLimit(size.width) : PANEL_WIDTH.max;

/**
 * The widest the column `side` may be while every column keeps its place:
 * the editor keeps {@link EDITOR_MIN} beside the columns as they are drawn,
 * so no edge, key or menu entry moves a column out of the side.
 */
export function columnLimit(
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
): number {
  const limit = drawnLimit(size);
  if (size === null) return limit;
  const placement = placePanels(panels, size);
  // A panel the placement takes out of the side has no column to keep.
  if (!isColumn(panels, placement, side)) return limit;
  const otherSide = side === "fields" ? "preview" : "fields";
  const other = panels[otherSide];
  const otherIsColumn = isColumn(panels, placement, otherSide);
  const handle = size.handle ?? 0;
  const room =
    size.width -
    EDITOR_MIN.width -
    handle -
    (otherIsColumn ? clampPanelWidth(other.width, limit) + handle : 0);
  return clampPanelWidth(room, limit);
}

/**
 * The size of `handle`'s panel as the reader sees it: a column's drawn
 * width, or the Preview's drawn height under the editor.
 */
function handleSize(
  panels: WorkbenchPanels,
  handle: PanelHandle,
  size: ViewSize | null,
) {
  if (handle !== "split")
    return clampPanelWidth(panels[handle].width, drawnLimit(size));
  return size
    ? previewBelowHeight(panels.preview.height, size.height)
    : panels.preview.height;
}

/** The size saved for `handle`'s panel: a column's width, or the Preview's share of the height. */
const storedSize = (handle: PanelHandle, panels: WorkbenchPanels) =>
  handle === "split" ? panels.preview.height : panels[handle].width;

/**
 * The Preview's share as drawn: a short view draws a saved share less
 * than it asks for, and a step starts from what the reader sees.
 */
export const drawnShare = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size && size.height > 0
    ? Math.min(
        panels.preview.height,
        Math.round(
          (previewBelowHeight(panels.preview.height, size.height) * 100) /
            size.height,
        ),
      )
    : panels.preview.height;

/** What sizing a panel reads besides the panels themselves. */
export interface PanelBounds {
  /** The view the panels are drawn in; null until the host measures it. */
  readonly size: ViewSize | null;
  /** The host's default panels, which a reset returns to. */
  readonly defaults: WorkbenchPanels;
}

/**
 * A column steps from the width the view draws, and every column size stays
 * within {@link columnLimit}, a reset too; the split steps from the share
 * the view draws.
 */
export function resizePanel(
  handle: PanelHandle,
  resize: PanelResize,
  { size, defaults }: PanelBounds,
): (panels: WorkbenchPanels) => WorkbenchPanels {
  if (handle === "split")
    return (panels) =>
      setPreviewHeight(
        resize === "reset"
          ? storedSize(handle, defaults)
          : drawnShare(panels, size) +
              (resize === "grow" ? MENU_STEP.height : -MENU_STEP.height),
      )(panels);
  return (panels) => {
    const step = resize === "grow" ? MENU_STEP.width : -MENU_STEP.width;
    const width =
      resize === "reset"
        ? storedSize(handle, defaults)
        : handleSize(panels, handle, size) + step;
    return setPanelWidth(
      handle,
      clampPanelWidth(width, columnLimit(panels, handle, size)),
    )(panels);
  };
}

/**
 * Whether {@link resizePanel} changes anything: a step what the reader
 * sees, a reset the size saved.
 */
export function canResizePanel(
  handle: PanelHandle,
  resize: PanelResize,
  bounds: PanelBounds,
): (panels: WorkbenchPanels) => boolean {
  const apply = resizePanel(handle, resize, bounds);
  const measure =
    resize === "reset"
      ? (panels: WorkbenchPanels) => storedSize(handle, panels)
      : (panels: WorkbenchPanels) => handleSize(panels, handle, bounds.size);
  return (panels) => measure(apply(panels)) !== measure(panels);
}
