// The side panels around the editor, headless: the pinned Fields Panel docked
// at the leading edge, the Preview Panel at the trailing edge or under the
// editor, each a labelled region the reader sizes with its handle, and the
// Fields Panel in the host's Fields popover while the reader has it open
// unpinned. The model says which panels show and where they go; the host's
// theme draws the parts and names the custom properties that carry each
// drawn size.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor";
import {
  DockedFieldsPanel,
  fieldsDockId,
  FieldsPopoverPanel,
} from "./fields-panel";
import { useContainerName, useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import {
  drawnMax,
  PANEL_HANDLES,
  PANEL_SIDES,
  resizePanel,
} from "./panel-layout";
import type {
  HandleSizing,
  PanelHandle,
  PanelMove,
  PanelSide,
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

/** The Fields Panel's side panel, with the host's own actions for its header. */
interface FieldsSidePanel extends SidePanel {
  readonly actions?: ReactNode;
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
  panels: { readonly fields?: FieldsSidePanel; readonly preview?: SidePanel };
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
  // A resize or a hide that takes the docked column away hands the focus it
  // held to the Fields action, which brings it back. The column's removal
  // marks that it held focus; the placement decides, so a column that still
  // stands, as through a development replay of its effects, keeps it.
  const dockHeldFocus = useRef(false);
  useLayoutEffect(() => {
    if (dockHeldFocus.current && placement.fields !== "docked")
      host?.fieldsAction?.focus();
    dockHeldFocus.current = false;
  }, [placement.fields, host]);
  return (
    <div {...part("panels")}>
      {panels.fields && placement.fields === "docked" && (
        <Panel
          side="fields"
          below={false}
          label={panels.fields.label}
          labelledBy={fieldsTitle}
          resizeLabel={panels.fields.resizeLabel}
          {...(popoverId === undefined ? {} : { id: fieldsDockId(popoverId) })}
          onLeave={() => {
            dockHeldFocus.current = true;
          }}
          content={
            <DockedFieldsPanel {...panels.fields} titleId={fieldsTitle} />
          }
        />
      )}
      <div {...part("stack", below ? "below" : "side")}>
        <div {...part("editor")}>{children}</div>
        {preview && <Panel side="preview" below={below} {...preview} />}
      </div>
      {panels.fields && <FieldsPopoverPanel {...panels.fields} />}
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

/**
 * The handlers of one window splitter, over the handle's
 * {@link PANEL_HANDLES} sizing. The arrows grow and shrink the panel the way
 * they point; Home and End set its smallest and largest size. Each press
 * reads the panels as they are, so presses faster than a render each count.
 * A drag writes the size to the region's own style while it moves, and to
 * the model once, where the reader lets go. A double-click resets the panel
 * to its default size.
 */
function useSizing(
  handle: PanelHandle,
  {
    outward,
    property,
  }: {
    /**
     * 1 where moving a column's edge to the right widens the column, -1
     * where it narrows it: the edge's side and the reading direction set it.
     */
    readonly outward: (handle: Element) => number;
    /** The custom property the region draws its size from. */
    readonly property: string;
  },
  region: RefObject<HTMLElement | null>,
) {
  const { model, registry } = useWorkbenchEditor();
  const panelsUpdate = useAtomSet(model.panels);
  const sizing: HandleSizing = PANEL_HANDLES[handle];
  // The handle's own value is what a screen reader reads now.
  const update = (change: (panels: WorkbenchPanels) => WorkbenchPanels) => {
    registry.set(model.sizedFromMenu, null);
    panelsUpdate(change);
  };
  // Each event reads the view as it is now.
  const viewSize = () => registry.get(model.viewSize);
  const bounds = () => ({ size: viewSize(), defaults: model.panelDefaults });
  // The keys that grow and shrink the panel: up gives the Preview under the
  // editor more height, and an edge grows the way it moves away from the editor.
  const keys = (element: Element) =>
    sizing.axis === "vertical"
      ? { grow: "ArrowUp", shrink: "ArrowDown" }
      : outward(element) > 0
        ? { grow: "ArrowRight", shrink: "ArrowLeft" }
        : { grow: "ArrowLeft", shrink: "ArrowRight" };
  // How far the pointer moved toward growth, in pixels.
  const moved = (element: Element, from: PointerEvent, to: PointerEvent) =>
    sizing.axis === "vertical"
      ? from.clientY - to.clientY
      : outward(element) * (to.clientX - from.clientX);
  const drag = useRef<{ from: PointerEvent; size: number } | null>(null);
  // The handle says it is dragged, so the host can draw it as held.
  const [dragging, setDragging] = useState(false);
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start
      ? start.size +
          sizing.fromPixels(
            moved(event.currentTarget, start.from, event),
            viewSize(),
          )
      : null;
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    setDragging(false);
    if (next !== null) update(sizing.write(next, viewSize()));
  };
  return {
    "data-dragging": dragging ? "" : undefined,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const { grow, shrink } = keys(event.currentTarget);
      const move: PanelMove | null =
        event.key === grow
          ? "grow"
          : event.key === shrink
            ? "shrink"
            : event.key === "Home"
              ? "min"
              : event.key === "End"
                ? "max"
                : null;
      if (move === null) return;
      event.preventDefault();
      update(
        resizePanel(handle, move, {
          ...bounds(),
          step: event.shiftKey ? "wide" : "key",
        }),
      );
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        from: event,
        size: sizing.drawn(registry.get(model.panels), viewSize()),
      };
      setDragging(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const next = dragged(event);
      if (next === null) return;
      const size = viewSize();
      const panels = sizing.write(next, size)(registry.get(model.panels));
      region.current?.style.setProperty(
        property,
        `${sizing.pixels(panels, size)}px`,
      );
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick() {
      update(resizePanel(handle, "reset", bounds()));
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
  const name = useContainerName(label);
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
  const { edge: standsAt } = PANEL_SIDES[side];
  const handle: PanelHandle = below ? "split" : side;
  const sizing = PANEL_HANDLES[handle];
  const vertical = sizing.axis === "vertical";
  const property = vertical ? properties.height : properties.width;
  const handlers = useSizing(
    handle,
    {
      // Moving the edge away from the editor widens the panel: a leading
      // column's edge toward the trailing side, a trailing column's toward
      // the leading side.
      outward: (element) =>
        (standsAt === "leading" ? 1 : -1) * (rightToLeft(element) ? -1 : 1),
      property,
    },
    region,
  );
  const sizeText = useSizeText();
  // The handle describes the panel as drawn: the view holds a saved size
  // within its own room, and a short view draws less than the saved share
  // to keep the editor's height.
  const separator = (
    <div
      ref={edge}
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      // A separator's orientation is the line it draws, across the way it moves.
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuemin={sizing.min}
      aria-valuemax={drawnMax(handle, panels, size)}
      aria-valuenow={sizing.drawn(panels, size)}
      aria-valuetext={sizeText(handle, panels, size)}
      {...handlers}
      {...(below ? part("split") : part("edge", side))}
    />
  );
  return (
    <>
      {standsAt === "trailing" && separator}
      <section
        ref={region}
        id={id}
        role="region"
        {...(labelledBy === undefined
          ? name.attrs
          : { "aria-labelledby": labelledBy })}
        data-panel={side}
        style={{ [property]: `${sizing.pixels(panels, size)}px` }}
        {...part("panel", below ? "below" : side)}
      >
        {labelledBy === undefined && name.hiddenName}
        {content}
      </section>
      {standsAt === "leading" && separator}
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
  return (handle, panels, size) => {
    const { unit, drawn } = PANEL_HANDLES[handle];
    const value = drawn(panels, size);
    return unit === "%"
      ? percent.format(value / 100)
      : m.workbench_panel_width_value({ width: value });
  };
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
          panel: labels[PANEL_HANDLES[sized].side],
          size: sizeText(sized, panels, size),
        })}
    </div>
  );
}
