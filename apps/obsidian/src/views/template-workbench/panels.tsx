// The side panels of the Template Workbench View: Fields on the left and
// Preview on the right of the editor, each a labelled region the reader shows
// with a view action and widens with its edge. The leaf's host model holds
// which panels show and how wide; CSS alone lays them out at every width.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

import { useUniqueId } from "@zotlit/ui";

import { cn } from "@/lib/utils";

import { clampPanelWidth, PANEL_WIDTH, setPanelWidth } from "./model";
import type { PanelSide, TemplateWorkbenchModel } from "./model";

/** What one side panel shows, and what names it to a screen reader. */
export interface SidePanel {
  /** The region's name. */
  readonly label: string;
  /** The resize handle's name. */
  readonly resizeLabel: string;
  readonly content: ReactNode;
}

/** The share of the panels' container one panel takes at most; `max-w-2/5`. */
const PANEL_SHARE = 0.4;
/** How far one arrow press moves a panel's edge, in pixels; Shift moves more. */
const STEP = 16;
const LARGE_STEP = 64;

/**
 * The editor between the panels the leaf shows. Below a narrow width the
 * panels stack under the editor, so a shown panel never hides the source.
 */
export function WorkbenchPanels({
  model,
  panels,
  children,
}: {
  model: TemplateWorkbenchModel;
  panels: Partial<Record<PanelSide, SidePanel>>;
  children: ReactNode;
}) {
  const state = useAtomValue(model.panels);
  const panel = (side: PanelSide) => {
    const content = panels[side];
    return content && state[side].shown ? (
      <Panel model={model} side={side} width={state[side].width} {...content} />
    ) : null;
  };
  return (
    <div className="zt:@container/workbench-panels zt:h-full zt:min-w-0">
      <div className="zt:flex zt:h-full zt:min-w-0 zt:@max-workbench-stack/workbench-panels:flex-col">
        {panel("fields")}
        <div className="zt:order-2 zt:min-h-0 zt:min-w-0 zt:flex-1 zt:@max-workbench-stack/workbench-panels:order-1">
          {children}
        </div>
        {panel("preview")}
      </div>
    </div>
  );
}

function Panel({
  model,
  side,
  width,
  label,
  resizeLabel,
  content,
}: {
  model: TemplateWorkbenchModel;
  side: PanelSide;
  width: number;
} & SidePanel) {
  const update = useAtomSet(model.panels);
  const id = useUniqueId();
  const region = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  // The Preview sits on the right, so moving its edge left widens it.
  const direction = side === "preview" ? -1 : 1;
  /**
   * The widest the view draws this panel now: the panel takes at most
   * {@link PANEL_SHARE} of the panels' container, so the source stays in view.
   */
  const drawnMax = () => {
    const container = region.current?.parentElement?.clientWidth;
    return container
      ? Math.min(PANEL_WIDTH.max, Math.floor(container * PANEL_SHARE))
      : PANEL_WIDTH.max;
  };
  const held = (next: number) => clampPanelWidth(next, drawnMax());
  const commit = (next: number) => update(setPanelWidth(side, held(next)));
  // A window splitter's Home and End set the panel's smallest and largest
  // width; the arrows move its edge the way they point.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? LARGE_STEP : STEP;
    const next =
      event.key === "ArrowLeft"
        ? width - direction * step
        : event.key === "ArrowRight"
          ? width + direction * step
          : event.key === "Home"
            ? PANEL_WIDTH.min
            : event.key === "End"
              ? PANEL_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    commit(next);
  };
  // A drag writes the width to the region's own style while it moves, and to
  // the model once, where the reader lets go.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start
      ? held(start.width + direction * (event.clientX - start.x))
      : null;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    if (next !== null)
      region.current?.style.setProperty("--zt-panel-width", `${next}px`);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    if (next !== null) commit(next);
  };
  const handle = (
    <div
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="zt:w-1 zt:shrink-0 zt:cursor-col-resize zt:bg-(--divider-color) zt:outline-none zt:hover:bg-(--interactive-accent) zt:focus-visible:bg-(--interactive-accent) zt:@max-workbench-stack/workbench-panels:hidden"
    />
  );
  return (
    <>
      {side === "preview" && <div className="zt:order-2 zt:flex">{handle}</div>}
      <section
        ref={region}
        id={id}
        role="region"
        aria-label={label}
        data-panel={side}
        style={{ "--zt-panel-width": `${width}px` } as CSSProperties}
        className={cn(
          side === "preview" ? "zt:order-3" : "zt:order-1",
          "zt:flex zt:min-h-0 zt:w-(--zt-panel-width) zt:max-w-2/5 zt:shrink-0 zt:flex-col zt:overflow-auto zt:@max-workbench-stack/workbench-panels:order-2 zt:@max-workbench-stack/workbench-panels:h-2/5 zt:@max-workbench-stack/workbench-panels:w-full zt:@max-workbench-stack/workbench-panels:max-w-none zt:@max-workbench-stack/workbench-panels:border-t-(length:--border-width) zt:@max-workbench-stack/workbench-panels:border-(--divider-color)",
        )}
      >
        {content}
      </section>
      {side === "fields" && <div className="zt:order-1 zt:flex">{handle}</div>}
    </>
  );
}
