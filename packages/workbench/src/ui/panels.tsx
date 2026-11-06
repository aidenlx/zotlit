// The side panels around the editor, headless: the Fields Panel at the
// leading edge, the Preview Panel at the trailing edge or under the editor,
// each a labelled region the reader sizes with its handle. The model says
// which panels show and where they go; the host's theme draws the parts.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import {
  clampPanelWidth,
  clampPreviewHeight,
  PANEL_WIDTH,
  panelLimit,
  PREVIEW_HEIGHT,
  previewBelowHeight,
  setPanelWidth,
  setPreviewHeight,
} from "./panel-layout";
import type { PanelSide } from "./panel-layout";
import { useParts } from "./theme";

/** What one side panel shows, and what names it to a screen reader. */
export interface SidePanel {
  /** The region's name. */
  readonly label: string;
  /** The resize handle's name. */
  readonly resizeLabel: string;
  readonly content: ReactNode;
}

/** How far one arrow press moves a panel's edge, in pixels; Shift moves more. */
const STEP = 16;
const LARGE_STEP = 64;
/** How far one arrow press moves the Preview's split, in percent of the view height. */
const HEIGHT_STEP = 5;

/** The width a column panel is drawn at, which a drag sets while it moves. */
const WIDTH_VAR = "--workbench-panel-width";
/** The height the Preview is drawn at under the editor. */
const HEIGHT_VAR = "--workbench-panel-height";

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
      {/* A "popover" placement draws the Fields Panel as a column until the
          popover picker draws it. */}
      {fields && (
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

function Column({
  side,
  width,
  label,
  resizeLabel,
  content,
}: { side: PanelSide; width: number } & SidePanel) {
  const model = useWorkbenchModel();
  const part = useParts("panels");
  const update = useAtomSet(model.panels);
  const size = useAtomValue(model.viewSize);
  const id = useUniqueId();
  const region = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number; sign: number } | null>(null);
  /** The widest the view draws this panel now. */
  const max = size ? panelLimit(size.width) : PANEL_WIDTH.max;
  const held = (next: number) => clampPanelWidth(next, max);
  // Moving the edge away from the editor widens the panel: the Fields edge
  // toward the trailing side, the Preview edge toward the leading side.
  const sign = (element: Element) =>
    (side === "fields" ? 1 : -1) * (rightToLeft(element) ? -1 : 1);
  const commit = (next: number) => update(setPanelWidth(side, held(next)));
  // A window splitter's Home and End set the panel's smallest and largest
  // width; the arrows move its edge the way they point, from the width the
  // panel is drawn at. Each press reads the panels as they are, so presses
  // faster than a render each count.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      (event.shiftKey ? LARGE_STEP : STEP) * sign(event.currentTarget);
    const move =
      event.key === "ArrowLeft"
        ? (drawn: number) => drawn - step
        : event.key === "ArrowRight"
          ? (drawn: number) => drawn + step
          : event.key === "Home"
            ? () => PANEL_WIDTH.min
            : event.key === "End"
              ? () => PANEL_WIDTH.max
              : null;
    if (move === null) return;
    event.preventDefault();
    update((panels) =>
      setPanelWidth(side, held(move(held(panels[side].width))))(panels),
    );
  };
  // A drag writes the width to the region's own style while it moves, and to
  // the model once, where the reader lets go.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      width: clampPanelWidth(width, max),
      sign: sign(event.currentTarget),
    };
  };
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start
      ? held(start.width + start.sign * (event.clientX - start.x))
      : null;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    if (next !== null)
      region.current?.style.setProperty(WIDTH_VAR, `${next}px`);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    if (next !== null) commit(next);
  };
  // The edge describes the panel as drawn: the view holds a saved width
  // within its own share.
  const handle = (
    <div
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      aria-orientation="vertical"
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={max}
      aria-valuenow={clampPanelWidth(width, max)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
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
        style={{ [WIDTH_VAR]: `${width}px` } as CSSProperties}
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
  const update = useAtomSet(model.panels);
  const size = useAtomValue(model.viewSize);
  const id = useUniqueId();
  const region = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; share: number } | null>(null);
  // Below is placed only in a measured view.
  const height = size?.height ?? 0;
  const drawn = previewBelowHeight(share, height);
  const commit = (next: number) => update(setPreviewHeight(next));
  // The arrows move the split the way they point: up gives the Preview more
  // height. Home and End set its smallest and largest share.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move =
      event.key === "ArrowUp"
        ? (current: number) => current + HEIGHT_STEP
        : event.key === "ArrowDown"
          ? (current: number) => current - HEIGHT_STEP
          : event.key === "Home"
            ? () => PREVIEW_HEIGHT.min
            : event.key === "End"
              ? () => PREVIEW_HEIGHT.max
              : null;
    if (move === null) return;
    event.preventDefault();
    update((panels) => setPreviewHeight(move(panels.preview.height))(panels));
  };
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start && height > 0
      ? clampPreviewHeight(
          start.share + ((start.y - event.clientY) / height) * 100,
        )
      : null;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, share };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    if (next !== null)
      region.current?.style.setProperty(
        HEIGHT_VAR,
        `${previewBelowHeight(next, height)}px`,
      );
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    if (next !== null) commit(next);
  };
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
        aria-valuetext={`${share}%`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        {...part("split")}
      />
      <section
        ref={region}
        id={id}
        role="region"
        aria-label={label}
        data-panel="preview"
        style={{ [HEIGHT_VAR]: `${drawn}px` } as CSSProperties}
        {...part("panel", "below")}
      >
        {content}
      </section>
    </>
  );
}
