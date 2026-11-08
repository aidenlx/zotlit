// The side panels around the editor, headless: the pinned Fields Panel docked
// at the leading edge, the Preview Panel at the trailing edge or under the
// editor, each a labelled region the reader sizes with its handle, and the
// Fields Panel in the host's Fields popover while the reader has it open
// unpinned. The model says which panels show and where they go; the host's
// theme draws the parts and names the custom properties that carry each
// drawn size.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor";
import { DockedFieldsPanel, fieldsDockId, FieldsPanel } from "./fields-panel";
import type { FieldsPanelContent } from "./fields-panel";
import { useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import {
  clampPanelWidth,
  clampPreviewHeight,
  handleSide,
  PANEL_SIDES,
  columnLimit,
  drawnShare,
  KEY_STEP,
  PREVIEW_HEIGHT,
  previewBelowHeight,
  resizePanel,
  setPanelWidth,
  setPreviewHeight,
} from "./panel-layout";
import type {
  PanelHandle,
  PanelSide,
  ShowableSide,
  ViewSize,
  WorkbenchPanels,
} from "./panel-layout";
import { usePanelProperties, useParts } from "./theme";

/** What one side panel shows, and what names it to a screen reader. */
export interface SidePanel {
  /** The region's name. */
  readonly label: string;
  /** The resize handle's name. */
  readonly resizeLabel: string;
  readonly content: ReactNode;
}

/**
 * The editor beside or above the Preview the reader shows, the docked Fields
 * Panel before both, and the Fields Panel in the host's Fields popover over
 * them while it stands open. Document order is docked Fields Panel, editor,
 * Preview Panel, Fields popover at every placement, so the layout needs no
 * visual reordering.
 */
export function SidePanels({
  panels,
  children,
}: {
  panels: Partial<Record<ShowableSide, SidePanel>> & {
    readonly fields?: FieldsPanelContent & {
      /** The docked panel's resize handle's name. */
      readonly resizeLabel: string;
    };
  };
  children: ReactNode;
}) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const state = useAtomValue(model.panels);
  const placement = useAtomValue(model.placement);
  const preview = panels.preview && state.preview.shown ? panels.preview : null;
  // The Preview stands at one place in the tree, after the editor, whether
  // it is a column beside it or under it: the stack lays the two out in a
  // row or a column, so a resize across the boundary moves the region
  // without mounting it again, and what the reader was doing in it stays.
  const below = placement.preview === "below";
  const host = useOptionalHost();
  const popoverId = host?.fieldsAction?.popoverId;
  const fieldsTitle = useUniqueId();
  return (
    <div {...part("panels")}>
      {panels.fields && placement.fields === "docked" && (
        <Panel
          side="fields"
          below={false}
          width={state.fields.width}
          share={state.preview.height}
          label={panels.fields.label}
          labelledBy={fieldsTitle}
          resizeLabel={panels.fields.resizeLabel}
          {...(popoverId === undefined ? {} : { id: fieldsDockId(popoverId) })}
          // A resize or a hide that takes the column away hands the focus
          // it held to the Fields action, which brings it back.
          onLeave={() => host?.fieldsAction?.focus()}
          content={
            <DockedFieldsPanel {...panels.fields} titleId={fieldsTitle} />
          }
        />
      )}
      <div {...part("stack", below ? "below" : "side")}>
        <div {...part("editor")}>{children}</div>
        {preview && (
          <Panel
            side="preview"
            below={below}
            width={state.preview.width}
            share={state.preview.height}
            {...preview}
          />
        )}
      </div>
      {panels.fields && <FieldsPanel {...panels.fields} />}
      {panels.fields && <FieldsStatusRegion />}
      <SizeStatus
        labels={{
          fields: panels.fields?.label ?? "",
          preview: panels.preview?.label ?? "",
        }}
      />
    </div>
  );
}

/** Whether `element` reads right to left, where the leading edge is the right. */
const rightToLeft = (element: Element) =>
  element.ownerDocument.defaultView?.getComputedStyle(element).direction ===
  "rtl";

/** How one handle sizes its panel, from the keyboard and the pointer. */
interface Sizing {
  /** The handle, which a double-click resets. */
  readonly handle: PanelHandle;
  /** The size as the reader sees it, from the panels as they are now. */
  readonly read: (panels: WorkbenchPanels) => number;
  /** Writes `size`; the transition holds it within its limits. */
  readonly write: (
    size: number,
  ) => (panels: WorkbenchPanels) => WorkbenchPanels;
  /** The keys that grow and shrink the panel, for the handle's direction. */
  readonly keys: (handle: Element) => { grow: string; shrink: string };
  readonly step: (event: KeyboardEvent) => number;
  readonly min: number;
  readonly max: number;
  /** How far a drag from `from` to `to` grows the panel, in the size's unit. */
  readonly dragged: (
    handle: Element,
    from: PointerEvent,
    to: PointerEvent,
  ) => number;
  /** The size held within its limits and as the region draws it, in pixels. */
  readonly drawn: (size: number) => number;
  /** The custom property the region draws its size from. */
  readonly property: string;
}

/**
 * The handlers of one window splitter. The arrows grow and shrink the panel
 * the way they point; Home and End set its smallest and largest size. Each
 * press reads the panels as they are, so presses faster than a render each
 * count. A drag writes the size to the region's own style while it moves,
 * and to the model once, where the reader lets go. A double-click resets
 * the panel to its default size.
 */
function useSizing(sizing: Sizing, region: RefObject<HTMLElement | null>) {
  const { model, registry } = useWorkbenchEditor();
  const panelsUpdate = useAtomSet(model.panels);
  // The handle's own value is what a screen reader reads now.
  const update = (change: (panels: WorkbenchPanels) => WorkbenchPanels) => {
    registry.set(model.sizedFromMenu, null);
    panelsUpdate(change);
  };
  const drag = useRef<{ from: PointerEvent; size: number } | null>(null);
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start
      ? start.size + sizing.dragged(event.currentTarget, start.from, event)
      : null;
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    if (next !== null) update(sizing.write(next));
  };
  return {
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const { grow, shrink } = sizing.keys(event.currentTarget);
      const step = sizing.step(event);
      const move =
        event.key === grow
          ? (size: number) => size + step
          : event.key === shrink
            ? (size: number) => size - step
            : event.key === "Home"
              ? () => sizing.min
              : event.key === "End"
                ? () => sizing.max
                : null;
      if (move === null) return;
      event.preventDefault();
      update((panels) => sizing.write(move(sizing.read(panels)))(panels));
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        from: event,
        size: sizing.read(registry.get(model.panels)),
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const next = dragged(event);
      if (next !== null)
        region.current?.style.setProperty(
          sizing.property,
          `${sizing.drawn(next)}px`,
        );
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick() {
      update(
        resizePanel(sizing.handle, "reset", {
          size: registry.get(model.viewSize),
          defaults: model.panelDefaults,
        }),
      );
    },
  };
}

/**
 * One side panel and its handle: a column beside the editor, or the Preview
 * under it. The Preview is the same component in either place, so moving it
 * across the boundary keeps the region and its contents mounted.
 */
function Panel({
  side,
  below,
  width,
  share,
  label,
  labelledBy,
  resizeLabel,
  content,
  id: givenId,
  onLeave,
}: {
  side: PanelSide;
  /** The Preview stands under the editor rather than beside it. */
  below: boolean;
  width: number;
  share: number;
  /**
   * The id of a title the region shows, which names it in place of `label`:
   * a host that draws `aria-label` as a hover tooltip then shows none over
   * the region.
   */
  labelledBy?: string;
  /** The region's id, where another control names it. */
  id?: string;
  /** Takes the focus the region or its handle holds as the panel goes. */
  onLeave?: () => void;
} & SidePanel) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const properties = usePanelProperties();
  const size = useAtomValue(model.viewSize);
  const panels = useAtomValue(model.panels);
  const uniqueId = useUniqueId();
  const id = givenId ?? uniqueId;
  const region = useRef<HTMLElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const leave = useRef(onLeave);
  useLayoutEffect(() => {
    leave.current = onLeave;
  });
  // The cleanup runs while the panel still holds the focus it had.
  useLayoutEffect(() => {
    const parts = [region.current, edge.current];
    return () => {
      const focused = parts[0]?.ownerDocument.activeElement;
      if (focused && parts.some((part) => part?.contains(focused)))
        leave.current?.();
    };
  }, []);
  const { edge: standsAt, width: widths } = PANEL_SIDES[side];
  /** The widest this panel may be while every column keeps its place. */
  const max = columnLimit(panels, side, size);
  const held = (next: number) => clampPanelWidth(next, max);
  // Moving the edge away from the editor widens the panel: a leading column's
  // edge toward the trailing side, a trailing column's toward the leading side.
  const outward = (handle: Element) =>
    (standsAt === "leading" ? 1 : -1) * (rightToLeft(handle) ? -1 : 1);
  // Below is placed only in a measured view.
  const viewHeight = size?.height ?? 0;
  const column: Sizing = {
    handle: side,
    read: (panels) => held(panels[side].width),
    write: (next) => setPanelWidth(side, held(next)),
    keys: (handle) =>
      outward(handle) > 0
        ? { grow: "ArrowRight", shrink: "ArrowLeft" }
        : { grow: "ArrowLeft", shrink: "ArrowRight" },
    step: (event) => (event.shiftKey ? KEY_STEP.wideWidth : KEY_STEP.width),
    min: widths.min,
    max,
    dragged: (handle, from, to) =>
      outward(handle) * (to.clientX - from.clientX),
    drawn: held,
    property: properties.width,
  };
  const split: Sizing = {
    handle: "split",
    // A short view draws less than the saved share; a step starts from
    // what the reader sees, as the menu's does.
    read: (panels) => drawnShare(panels, size),
    write: setPreviewHeight,
    // Up gives the Preview more height.
    keys: () => ({ grow: "ArrowUp", shrink: "ArrowDown" }),
    step: () => KEY_STEP.height,
    min: PREVIEW_HEIGHT.min,
    max: PREVIEW_HEIGHT.max,
    dragged: (_handle, from, to) =>
      viewHeight > 0 ? ((from.clientY - to.clientY) / viewHeight) * 100 : 0,
    drawn: (next) => previewBelowHeight(clampPreviewHeight(next), viewHeight),
    property: properties.height,
  };
  const handlers = useSizing(below ? split : column, region);
  const shown = drawnShare(panels, size);
  const sizeText = useSizeText();
  // The handle describes the panel as drawn: the view holds a saved width
  // within its own share.
  const handle = (
    <div
      ref={edge}
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      {...(below
        ? {
            "aria-orientation": "horizontal",
            "aria-valuemin": PREVIEW_HEIGHT.min,
            "aria-valuemax": drawnShare(
              setPreviewHeight(PREVIEW_HEIGHT.max)(panels),
              size,
            ),
            // The share as drawn: a short view draws less than the saved
            // share to keep the editor's height.
            "aria-valuenow": shown,
            "aria-valuetext": sizeText("split", panels, size),
          }
        : {
            "aria-orientation": "vertical",
            "aria-valuemin": widths.min,
            "aria-valuemax": max,
            "aria-valuenow": held(width),
            "aria-valuetext": sizeText(side, panels, size),
          })}
      {...handlers}
      {...(below ? part("split") : part("edge", side))}
    />
  );
  return (
    <>
      {standsAt === "trailing" && handle}
      <section
        ref={region}
        id={id}
        role="region"
        {...(labelledBy === undefined
          ? { "aria-label": label }
          : { "aria-labelledby": labelledBy })}
        data-panel={side}
        style={
          below
            ? {
                [properties.height]: `${previewBelowHeight(share, viewHeight)}px`,
              }
            : { [properties.width]: `${held(width)}px` }
        }
        {...part("panel", below ? "below" : side)}
      >
        {content}
      </section>
      {standsAt === "leading" && handle}
    </>
  );
}

/** What a handle's panel measures as drawn, in words a screen reader reads. */
function useSizeText(): (
  handle: PanelHandle,
  panels: WorkbenchPanels,
  size: ViewSize | null,
) => string {
  const m = useWorkbenchMessages();
  const host = useOptionalHost();
  const percent = new Intl.NumberFormat(host?.getLocale(), {
    style: "percent",
  });
  return (handle, panels, size) =>
    handle === "split"
      ? percent.format(drawnShare(panels, size) / 100)
      : m.workbench_panel_width_value({
          width: clampPanelWidth(
            panels[handle].width,
            columnLimit(panels, handle, size),
          ),
        });
}

/**
 * The polite status that says what the Fields Panel last did, such as
 * "Inserted Title.", in either presentation. It stands outside the Fields
 * popover, so an insert that closes the popover is still heard. Each new
 * status is a new node, so a repeat is heard again.
 */
function FieldsStatusRegion() {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const status = useAtomValue(model.fieldsStatus);
  return (
    <div role="status" {...part("status")}>
      {status && <span key={status.count}>{status.text}</span>}
    </div>
  );
}

/**
 * The polite status that says the size a menu entry gave, such as
 * "Preview: 50%": a menu entry moves no focus to the handle, whose own value
 * a screen reader would read. It stands empty otherwise.
 */
function SizeStatus({
  labels,
}: {
  /** Each panel's name, as its region reads it. */
  labels: Record<PanelSide, string>;
}) {
  const model = useWorkbenchModel();
  const m = useWorkbenchMessages();
  const part = useParts("panels");
  const sized = useAtomValue(model.sizedFromMenu);
  const panels = useAtomValue(model.panels);
  const size = useAtomValue(model.viewSize);
  const sizeText = useSizeText();
  return (
    <div role="status" {...part("status")}>
      {sized &&
        m.workbench_panel_size_status({
          panel: labels[handleSide(sized)],
          size: sizeText(sized, panels, size),
        })}
    </div>
  );
}
