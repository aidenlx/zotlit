// The side panels beside the editor: what the reader chose to show and how
// wide or tall, and where each shown panel goes in a view of a given size.
// The choice is saved state; the placement is derived from it and the view
// size and never saved, so resizing a view changes only the placement. The
// Fields sheet takes no side: it opens over the editor while the reader has
// it open, at every width.

import { patchAt } from "./patch";

/** The side panels beside the editor: the Preview at the trailing edge. */
export type PanelSide = "preview";
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
  readonly preview: PreviewPanel;
}

/**
 * The widths a panel can take, in pixels. The Preview column grows as far
 * as the editor keeps {@link EDITOR_MIN} beside it; `max` holds it in a view
 * not measured yet.
 */
export const PANEL_WIDTH = { min: 240, initial: 400, max: 960 } as const;

/**
 * The narrowest view, in pixels, that shows the Preview as a column: 56rem
 * at the 16 px root font size both hosts draw with, Tailwind's `@4xl`
 * container width. A narrower view puts the Preview under the editor.
 */
export const PREVIEW_SIDE_MIN = 896;

/** The shares of the view height the Preview takes under the editor, in percent. */
export const PREVIEW_HEIGHT = { min: 20, initial: 40, max: 80 } as const;

/**
 * The least room the editor keeps beside and above the panels, in pixels.
 * The height holds the editor's toolbar and tab rows, the tab's one-line
 * task, and five lines of source; a host draws the source at least five
 * lines tall and scrolls the tab when its content needs more.
 */
export const EDITOR_MIN = { width: 360, height: 320 } as const;

/** A new editor shows no panel. */
export const INITIAL_PANELS: WorkbenchPanels = {
  preview: {
    shown: false,
    width: PANEL_WIDTH.initial,
    height: PREVIEW_HEIGHT.initial,
  },
};

/**
 * `width` held within {@link PANEL_WIDTH}, and within `max` where the host
 * draws the panel narrower than that.
 */
export const clampPanelWidth = (width: number, max: number = PANEL_WIDTH.max) =>
  Math.round(
    Math.min(Math.max(PANEL_WIDTH.min, max), Math.max(PANEL_WIDTH.min, width)),
  );

/**
 * `width` as saved for `side`: at least its `min`, as the view holds it to
 * the room the editor leaves.
 */
export const savedPanelWidth = (_side: PanelSide, width: number) =>
  Math.round(Math.max(PANEL_WIDTH.min, width));

/** `share` held within {@link PREVIEW_HEIGHT}. */
export const clampPreviewHeight = (share: number) =>
  Math.round(Math.min(PREVIEW_HEIGHT.max, Math.max(PREVIEW_HEIGHT.min, share)));

export const showPanel = (side: PanelSide, shown: boolean) =>
  patchAt<WorkbenchPanels, PanelSide>(side, { shown });
/** Sets a panel's width, held as {@link savedPanelWidth} says. */
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchAt<WorkbenchPanels, PanelSide>(side, {
    width: savedPanelWidth(side, width),
  });
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
 * nowhere while it is hidden. The Fields sheet stands over the editor while
 * the reader has it open, at every width.
 */
export interface PanelPlacement {
  readonly preview: "side" | "below" | "hidden";
  readonly fields: "sheet" | "closed";
}

/** Whether the Fields sheet the Fields action opens stands open. */
export interface FieldsAction {
  readonly open: boolean;
}

/**
 * The widest a host draws `side`'s column in a view of `size`: as wide as
 * the editor keeps {@link EDITOR_MIN} beside it. A view not measured yet
 * holds it to {@link PANEL_WIDTH}'s `max`, and draws a Preview saved wider
 * at its saved width.
 */
const sideLimit = (
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
) =>
  size
    ? Math.max(
        PANEL_WIDTH.min,
        size.width - EDITOR_MIN.width - (size.handle ?? 0),
      )
    : Math.max(PANEL_WIDTH.max, panels[side].width);

/** `side`'s width as a column in a view of `size`. */
const drawnWidth = (
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
) => clampPanelWidth(panels[side].width, sideLimit(panels, side, size));

/**
 * Places the panels in a view of `size`; a view not measured yet places the
 * Preview as a column. The Preview is a column in a view
 * {@link PREVIEW_SIDE_MIN} wide or wider. The Fields sheet stands while
 * `fieldsOpen` says so: no view size opens or closes it.
 */
export function placePanels(
  panels: WorkbenchPanels,
  size: ViewSize | null,
  fieldsOpen: boolean,
): PanelPlacement {
  const fields = fieldsOpen ? "sheet" : "closed";
  if (!panels.preview.shown) return { preview: "hidden", fields };
  return {
    preview: size === null || size.width >= PREVIEW_SIDE_MIN ? "side" : "below",
    fields,
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
 * The handles that size the panels: the edge of the Preview column, and the
 * split over the Preview under the editor.
 */
export type PanelHandle = PanelSide | "split";
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

/** The handles a view of `size` draws for `panels`, in document order. */
export function panelHandles(
  panels: WorkbenchPanels,
  size: ViewSize | null,
): readonly PanelHandle[] {
  const { preview } = placePanels(panels, size, false);
  return preview === "side"
    ? ["preview"]
    : preview === "below"
      ? ["split"]
      : [];
}

/**
 * The widest the column `side` may be while the editor keeps
 * {@link EDITOR_MIN} beside it, so no edge, key or menu entry moves the
 * column out of the side.
 */
export function columnLimit(
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
): number {
  return sideLimit(panels, side, size);
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
  if (handle !== "split") return drawnWidth(panels, handle, size);
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
