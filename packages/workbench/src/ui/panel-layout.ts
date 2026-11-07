// The side panels beside the editor: what the reader chose to show and how
// wide or tall, and where each shown panel goes in a view of a given size.
// The choice is saved state; the placement is derived from it and the view
// size and never saved, so resizing a view changes only the placement. The
// Fields Panel takes no side while it is not pinned: it opens as a popover
// at the view's right edge while the reader has it open, at every width.
// Pinned, it docks as a column at the leading edge where the view has room.

import type { WorkbenchMessages } from "./generated/messages";
import { patchAt } from "./patch";

/**
 * The side panels beside the editor: the docked Fields Panel at the leading
 * edge, the Preview at the trailing edge.
 */
export type PanelSide = "fields" | "preview";
/**
 * The side panel a view action shows and hides. The Fields Panel opens from
 * the Fields action instead, and docks while the reader has it pinned.
 */
export type ShowableSide = "preview";
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
/** The Fields Panel's saved facts, which dock it beside the editor. */
export interface FieldsDock {
  /** The reader pinned the panel, which docks it where the view has room. */
  readonly pinned: boolean;
  /** The Fields action hid the pinned panel; the pin stays. */
  readonly hidden: boolean;
  /** The docked panel's width in pixels, within {@link FIELDS_WIDTH}. */
  readonly width: number;
}
export interface WorkbenchPanels {
  readonly fields: FieldsDock;
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

/** The widths the docked Fields Panel takes, in pixels. */
export const FIELDS_WIDTH = { min: 240, initial: 320, max: 480 } as const;

/** A new editor shows no panel. */
export const INITIAL_PANELS: WorkbenchPanels = {
  fields: { pinned: false, hidden: false, width: FIELDS_WIDTH.initial },
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
 * `width` as saved for `side`: within its widths, as far as {@link PANEL_SIDES}
 * holds a saved width; the view holds a Preview to the room the editor leaves.
 */
export const savedPanelWidth = (side: PanelSide, width: number) => {
  const { width: widths, savedMax } = PANEL_SIDES[side];
  return Math.round(Math.min(savedMax, Math.max(widths.min, width)));
};

/** `share` held within {@link PREVIEW_HEIGHT}. */
export const clampPreviewHeight = (share: number) =>
  Math.round(Math.min(PREVIEW_HEIGHT.max, Math.max(PREVIEW_HEIGHT.min, share)));

export const showPanel = (side: ShowableSide, shown: boolean) =>
  patchAt<WorkbenchPanels, ShowableSide>(side, { shown });
/** Sets a panel's width, held as {@link savedPanelWidth} says. */
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchAt<WorkbenchPanels, PanelSide>(side, {
    width: savedPanelWidth(side, width),
  });
/** Pins or unpins the Fields Panel; either way it is no longer hidden. */
export const pinFields = (pinned: boolean) =>
  patchAt<WorkbenchPanels, "fields">("fields", { pinned, hidden: false });
/** Hides or shows the pinned Fields Panel, which keeps its pin. */
export const hideFields = (hidden: boolean) =>
  patchAt<WorkbenchPanels, "fields">("fields", { hidden });
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
 * Where the Fields Panel goes: docked at the view's leading edge, a popover
 * at its right edge, or nowhere.
 */
export type FieldsPlacement = "docked" | "popover" | "closed";

/**
 * Where each panel goes. The Preview stands beside the editor, under it, or
 * nowhere while it is hidden. The Fields Panel docks while it is pinned,
 * shown and the view has room, and otherwise stands as a popover over the
 * editor while the reader has it open.
 */
export interface PanelPlacement {
  readonly preview: "side" | "below" | "hidden";
  readonly fields: FieldsPlacement;
  /** Whether the view has room to dock the Fields Panel, so its pin works. */
  readonly canPin: boolean;
}

/**
 * Whether the Fields Panel's popover is open, and where focus goes when it
 * closed: `closed` hands it back to the Fields action, `to-editor` leaves it
 * to the surface that takes it next: the editor after an insert or a repair
 * command, the docked panel after a pin. Never saved.
 */
export type FieldsPanelState = "open" | "closed" | "to-editor";

/** Whether the Fields Panel is pinned, and whether the view has room to dock it. */
export interface FieldsPin {
  readonly pinned: boolean;
  readonly canPin: boolean;
}

/** Whether the Fields Panel the Fields action opens stands open, and where. */
export interface FieldsAction {
  readonly open: boolean;
  readonly placement: FieldsPlacement;
}

/** Where the Preview goes in a view of `size`; a view not measured yet draws it as a column. */
const previewPlace = (
  panels: WorkbenchPanels,
  size: ViewSize | null,
): PanelPlacement["preview"] =>
  !panels.preview.shown
    ? "hidden"
    : size === null || size.width >= PREVIEW_SIDE_MIN
      ? "side"
      : "below";

/**
 * The widest a host draws the Preview column in a view of `size`: as wide
 * as the editor keeps {@link EDITOR_MIN} beside it. A view not measured yet
 * holds it to {@link PANEL_WIDTH}'s `max`, and draws a Preview saved wider
 * at its saved width.
 */
const previewLimit = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size
    ? Math.max(
        PANEL_WIDTH.min,
        size.width - EDITOR_MIN.width - (size.handle ?? 0),
      )
    : Math.max(PANEL_WIDTH.max, panels.preview.width);

/**
 * The room the docked Fields Panel and the editor share in a view of `size`:
 * the view less the Preview column and its handle, which claim the side
 * first.
 */
const fieldsRoom = (panels: WorkbenchPanels, size: ViewSize) =>
  size.width -
  (previewPlace(panels, size) === "side"
    ? clampPanelWidth(panels.preview.width, previewLimit(panels, size)) +
      (size.handle ?? 0)
    : 0);

/**
 * The widest a host draws the docked Fields Panel in a view of `size`:
 * within {@link FIELDS_WIDTH}, and as wide as the editor keeps
 * {@link EDITOR_MIN} beside it.
 */
const fieldsLimit = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size
    ? Math.min(
        FIELDS_WIDTH.max,
        Math.max(
          FIELDS_WIDTH.min,
          fieldsRoom(panels, size) - (size.handle ?? 0) - EDITOR_MIN.width,
        ),
      )
    : FIELDS_WIDTH.max;

/** What sets one side column apart from the other. */
export interface SideColumn {
  /** The widths the column takes, in pixels. */
  readonly width: {
    readonly min: number;
    readonly initial: number;
    readonly max: number;
  };
  /** The widest width saved; a view holds what it draws within its own room. */
  readonly savedMax: number;
  /**
   * The view's edge the column stands at: the leading edge, before the
   * editor in document order, with its handle after it; or the trailing
   * edge, after the editor, with its handle before it.
   */
  readonly edge: "leading" | "trailing";
  /** The widest a host draws the column in a view of `size`, before the other column limits it. */
  readonly limit: (panels: WorkbenchPanels, size: ViewSize | null) => number;
  /** Whether `placement` puts the column beside the editor. */
  readonly placed: (placement: PanelPlacement) => boolean;
  /** The panel's name, as a size status reads it. */
  readonly label: (m: WorkbenchMessages) => string;
  /** The name of the handle and the size menu that size the column. */
  readonly resizeLabel: (m: WorkbenchMessages) => string;
}

/** Each side column: the docked Fields Panel and the Preview. */
export const PANEL_SIDES: Readonly<Record<PanelSide, SideColumn>> = {
  fields: {
    width: FIELDS_WIDTH,
    savedMax: FIELDS_WIDTH.max,
    edge: "leading",
    limit: (panels, size) => fieldsLimit(panels, size),
    placed: (placement) => placement.fields === "docked",
    label: (m) => m.workbench_view_fields(),
    resizeLabel: (m) => m.workbench_fields_resize(),
  },
  preview: {
    width: PANEL_WIDTH,
    savedMax: Number.POSITIVE_INFINITY,
    edge: "trailing",
    limit: (panels, size) => previewLimit(panels, size),
    placed: (placement) => placement.preview === "side",
    label: (m) => m.workbench_view_preview(),
    resizeLabel: (m) => m.workbench_preview_resize(),
  },
};

/** The column on the other side of the editor from `side`. */
const otherSide = (side: PanelSide): PanelSide =>
  (Object.keys(PANEL_SIDES) as PanelSide[]).find((other) => other !== side)!;

/** The side panel a handle sizes: the split sizes the Preview under the editor. */
export const handleSide = (handle: PanelHandle): PanelSide =>
  handle === "split" ? "preview" : handle;

/** `side`'s width as a column in a view of `size`, before the other column limits it. */
const drawnWidth = (
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
) => clampPanelWidth(panels[side].width, PANEL_SIDES[side].limit(panels, size));

/**
 * Places the panels in a view of `size`; a view not measured yet places the
 * Preview as a column and docks a pinned Fields Panel. The Preview is a
 * column in a view {@link PREVIEW_SIDE_MIN} wide or wider, and claims the
 * side first. A pinned, shown Fields Panel docks while the editor keeps
 * {@link EDITOR_MIN} beside the panel's least width; otherwise it stands as
 * a popover while `fieldsOpen` says so. No view size opens the popover.
 */
export function placePanels(
  panels: WorkbenchPanels,
  size: ViewSize | null,
  fieldsOpen: boolean,
): PanelPlacement {
  const canPin =
    size === null ||
    fieldsRoom(panels, size) - (size.handle ?? 0) >=
      FIELDS_WIDTH.min + EDITOR_MIN.width;
  const { pinned, hidden } = panels.fields;
  return {
    preview: previewPlace(panels, size),
    fields:
      pinned && !hidden && canPin
        ? "docked"
        : fieldsOpen
          ? "popover"
          : "closed",
    canPin,
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
 * The handles that size the panels: the edge of the docked Fields Panel, the
 * edge of the Preview column, and the split over the Preview under the
 * editor.
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
  const { preview, fields } = placePanels(panels, size, false);
  const handles: PanelHandle[] = [];
  if (fields === "docked") handles.push("fields");
  if (preview === "side") handles.push("preview");
  if (preview === "below") handles.push("split");
  return handles;
}

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
  const limit = PANEL_SIDES[side].limit(panels, size);
  if (size === null) return limit;
  const placement = placePanels(panels, size, false);
  const other = otherSide(side);
  // A column leaves the other column the room it is drawn at.
  if (
    !PANEL_SIDES[side].placed(placement) ||
    !PANEL_SIDES[other].placed(placement)
  )
    return limit;
  const handle = size.handle ?? 0;
  return clampPanelWidth(
    size.width -
      EDITOR_MIN.width -
      handle -
      (drawnWidth(panels, other, size) + handle),
    limit,
  );
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
