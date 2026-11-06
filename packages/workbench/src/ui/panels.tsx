// The side panels around the editor, headless: the Fields Panel at the
// leading edge, the Preview Panel at the trailing edge or under the editor,
// each a labelled region the reader sizes with its handle. The model says
// which panels show and where they go; the host's theme draws the parts and
// names the custom properties that carry each drawn size.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor";
import { useOptionalHost } from "./host";
import {
  clampPanelWidth,
  clampPreviewHeight,
  PANEL_WIDTH,
  columnLimit,
  PREVIEW_HEIGHT,
  previewBelowHeight,
  resizePanel,
  setPanelWidth,
  setPreviewHeight,
} from "./panel-layout";
import type { PanelHandle, PanelSide, WorkbenchPanels } from "./panel-layout";
import { usePanelProperties, useParts } from "./theme";

/** What one side panel shows, and what names it to a screen reader. */
export interface SidePanel {
  /** The region's name. */
  readonly label: string;
  /** The resize handle's name. */
  readonly resizeLabel: string;
  readonly content: ReactNode;
  /**
   * The Fields Panel's content as a picker, a `FieldPicker`, which the Fields
   * action opens where the column does not fit.
   */
  readonly picker?: ReactNode;
}

/**
 * The editor between the panels the reader shows. Document order is Fields
 * Panel, editor, Preview Panel at every placement, so the layout needs no
 * visual reordering.
 */
export function SidePanels({
  panels,
  children,
}: {
  panels: Partial<Record<PanelSide, SidePanel>>;
  children: ReactNode;
}) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const state = useAtomValue(model.panels);
  const placement = useAtomValue(model.placement);
  const fields = panels.fields && state.fields.shown ? panels.fields : null;
  const preview = panels.preview && state.preview.shown ? panels.preview : null;
  return (
    <div {...part("panels")}>
      {/* Where the column does not fit, the Fields action opens the picker
          over the editor, shown or not. */}
      {placement.fields === "popover"
        ? panels.fields?.picker
        : fields && (
            <Column side="fields" width={state.fields.width} {...fields} />
          )}
      <div {...part("stack")}>
        <div {...part("editor")}>{children}</div>
        {preview && placement.preview === "below" && (
          <Below share={state.preview.height} {...preview} />
        )}
      </div>
      {preview && placement.preview === "side" && (
        <Column side="preview" width={state.preview.width} {...preview} />
      )}
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
  const update = useAtomSet(model.panels);
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

function Column({
  side,
  width,
  label,
  resizeLabel,
  content,
}: { side: PanelSide; width: number } & SidePanel) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const properties = usePanelProperties();
  const size = useAtomValue(model.viewSize);
  const panels = useAtomValue(model.panels);
  const id = useUniqueId();
  const region = useRef<HTMLElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const host = useOptionalHost();
  // The Fields column goes when a resize leaves it no room or the reader
  // hides it. Focus it held then goes to the Fields action, which brings it
  // back; the cleanup runs while the column still holds that focus.
  useLayoutEffect(() => {
    if (side !== "fields") return;
    const parts = [region.current, edge.current];
    return () => {
      const focused = parts[0]?.ownerDocument.activeElement;
      if (focused && parts.some((element) => element?.contains(focused)))
        host?.fieldsAction?.focus();
    };
  }, [side, host]);
  /** The widest this panel may be while every column keeps its place. */
  const max = columnLimit(panels, side, size);
  const held = (next: number) => clampPanelWidth(next, max);
  // Moving the edge away from the editor widens the panel: the Fields edge
  // toward the trailing side, the Preview edge toward the leading side.
  const outward = (handle: Element) =>
    (side === "fields" ? 1 : -1) * (rightToLeft(handle) ? -1 : 1);
  const handlers = useSizing(
    {
      handle: side,
      read: (panels) => held(panels[side].width),
      write: (next) => setPanelWidth(side, held(next)),
      keys: (handle) =>
        outward(handle) > 0
          ? { grow: "ArrowRight", shrink: "ArrowLeft" }
          : { grow: "ArrowLeft", shrink: "ArrowRight" },
      step: (event) => (event.shiftKey ? 64 : 16),
      min: PANEL_WIDTH.min,
      max,
      dragged: (handle, from, to) =>
        outward(handle) * (to.clientX - from.clientX),
      drawn: held,
      property: properties.width,
    },
    region,
  );
  // The edge describes the panel as drawn: the view holds a saved width
  // within its own share.
  const handle = (
    <div
      ref={edge}
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      aria-orientation="vertical"
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={max}
      aria-valuenow={held(width)}
      {...handlers}
      {...part("edge", side)}
    />
  );
  return (
    <>
      {side === "preview" && handle}
      <section
        ref={region}
        id={id}
        role="region"
        aria-label={label}
        data-panel={side}
        style={{ [properties.width]: `${width}px` }}
        {...part("panel", side)}
      >
        {content}
      </section>
      {side === "fields" && handle}
    </>
  );
}

/** The Preview under the editor, at its share of the view height. */
function Below({
  share,
  label,
  resizeLabel,
  content,
}: { share: number } & SidePanel) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const properties = usePanelProperties();
  const host = useOptionalHost();
  const size = useAtomValue(model.viewSize);
  const id = useUniqueId();
  const region = useRef<HTMLElement>(null);
  // Below is placed only in a measured view.
  const viewHeight = size?.height ?? 0;
  const handlers = useSizing(
    {
      handle: "split",
      read: (panels) => panels.preview.height,
      write: setPreviewHeight,
      // Up gives the Preview more height.
      keys: () => ({ grow: "ArrowUp", shrink: "ArrowDown" }),
      step: () => 5,
      min: PREVIEW_HEIGHT.min,
      max: PREVIEW_HEIGHT.max,
      dragged: (_handle, from, to) =>
        viewHeight > 0 ? ((from.clientY - to.clientY) / viewHeight) * 100 : 0,
      drawn: (next) => previewBelowHeight(clampPreviewHeight(next), viewHeight),
      property: properties.height,
    },
    region,
  );
  const percent = new Intl.NumberFormat(host?.getLocale(), {
    style: "percent",
  });
  return (
    <>
      <div
        role="separator"
        tabIndex={0}
        aria-label={resizeLabel}
        aria-controls={id}
        aria-orientation="horizontal"
        aria-valuemin={PREVIEW_HEIGHT.min}
        aria-valuemax={PREVIEW_HEIGHT.max}
        // The reader's share; a short view draws less to keep the editor's.
        aria-valuenow={share}
        aria-valuetext={percent.format(share / 100)}
        {...handlers}
        {...part("split")}
      />
      <section
        ref={region}
        id={id}
        role="region"
        aria-label={label}
        data-panel="preview"
        style={{
          [properties.height]: `${previewBelowHeight(share, viewHeight)}px`,
        }}
        {...part("panel", "below")}
      >
        {content}
      </section>
    </>
  );
}
