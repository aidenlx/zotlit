// The research desk: one flat drawing of an academic's desk seen from above,
// one object per research job. It is the landing's Figure 1, then its table of
// contents. Each object is drawn once, in <DeskSprite>, and every desk and
// pictogram on the page reuses it, which keeps the prerendered HTML small.
// @see apps/docs/DESIGN.md → The research desk

import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

import { DESK_LAYOUT, DESK_OBJECTS, Mug } from "./desk-art";
import { JOBS } from "./jobs";
import type { JobId } from "./jobs";

const L = DESK_LAYOUT;
const artId = (id: JobId) => `desk-art-${id}`;
const pct = (val: number, total: number) => `${(val / total) * 100}%`;

function box(id: JobId) {
  const o = DESK_OBJECTS[id];
  const p: { x: number; y: number; r: number; deep?: boolean } = L.at[id];
  return { o, p, w: o.w, h: o.h };
}

/**
 * The drawings every desk and pictogram on the page reuse, as SVG groups in a
 * zero-size sprite. Strokes are 1px and keep that width at every scale.
 */
export function DeskSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="absolute size-0 overflow-hidden [&_*]:[stroke-width:1px] [&_*]:[vector-effect:non-scaling-stroke]"
    >
      <defs>
        <filter id="desk-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        {JOBS.map((j) => {
          const { Art } = DESK_OBJECTS[j.id];
          return (
            <g key={j.id} id={artId(j.id)}>
              <Art />
            </g>
          );
        })}
      </defs>
    </svg>
  );
}

/** The flat shadow an object casts: its shadow shapes offset by (3, 12) and blurred. */
function Shade({ id, deep }: { id: JobId; deep?: boolean }) {
  return (
    <g filter="url(#desk-soft)">
      {DESK_OBJECTS[id].shade.map(([x, y, w, h, rx], k) => (
        <rect
          // oxlint-disable-next-line react/no-array-index-key -- fixed shapes in a fixed order
          key={k}
          x={x + 3}
          y={y + 12}
          width={w}
          height={h}
          rx={rx}
          fill={deep ? "var(--desk-shadow-deep)" : "var(--desk-shadow)"}
        />
      ))}
    </g>
  );
}

function Blotter() {
  const b = L.blotter;
  const c = 64;
  const R = b.x + b.w;
  const B = b.y + b.h;
  return (
    <g>
      <rect width={L.W} height={L.H} rx="24" fill="var(--desk-surface)" />
      <rect
        x={b.x}
        y={b.y + 14}
        width={b.w}
        height={b.h}
        rx="10"
        fill="var(--desk-shadow)"
        filter="url(#desk-soft)"
      />
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx="10"
        fill="var(--desk-blotter)"
      />
      <g fill="var(--desk-blot-corner)">
        <path
          d={`M${b.x + 10},${b.y}H${b.x + c}L${b.x},${b.y + c}V${b.y + 10}A10 10 0 0 1 ${b.x + 10},${b.y}Z`}
        />
        <path
          d={`M${R - 10},${b.y}H${R - c}L${R},${b.y + c}V${b.y + 10}A10 10 0 0 0 ${R - 10},${b.y}Z`}
        />
        <path
          d={`M${b.x + 10},${B}H${b.x + c}L${b.x},${B - c}V${B - 10}A10 10 0 0 0 ${b.x + 10},${B}Z`}
        />
        <path
          d={`M${R - 10},${B}H${R - c}L${R},${B - c}V${B - 10}A10 10 0 0 1 ${R - 10},${B}Z`}
        />
      </g>
      <rect
        x={b.x + 16}
        y={b.y + 16}
        width={b.w - 32}
        height={b.h - 32}
        rx="4"
        fill="none"
        stroke="var(--desk-stitch)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        strokeDasharray="8 7"
      />
    </g>
  );
}

export interface DeskProps {
  /** The job whose object is ringed while the others fade. */
  focus?: JobId | null;
  /** Numbered markers at each object's corner (the hero figure). */
  markers?: boolean;
  /**
   * The moving copy between the hero and the contents column: the markers fade
   * out over the first half of the way, and the ring and the fade on the other
   * objects follow the page's scroll progress `--desk-p`.
   */
  morph?: boolean;
  /** The job named in an ink tag beside its marker (the object under the pointer). */
  tag?: JobId | null;
  /** Pointer hit areas over the objects; they repeat the key, so they stay out of the tab order. */
  onPointAt?: (id: JobId | null) => void;
  onPick?: (id: JobId) => void;
  className?: string;
  style?: CSSProperties;
}

/** One desk, from the drawings in <DeskSprite>. */
export function Desk({
  focus = null,
  markers = false,
  morph = false,
  tag = null,
  onPointAt,
  onPick,
  className,
  style,
}: DeskProps) {
  return (
    <div
      className={cn("relative w-full", className)}
      style={{ aspectRatio: `${L.W} / ${L.H}`, ...style }}
    >
      <svg
        viewBox={`0 0 ${L.W} ${L.H}`}
        className="absolute inset-0 size-full"
        aria-hidden="true"
        focusable="false"
      >
        <Blotter />
        <Mug x={L.mug[0]!} y={L.mug[1]!} />
        {JOBS.map((j) => {
          const { o, p, w, h } = box(j.id);
          const on = focus === j.id;
          return (
            <g
              key={j.id}
              transform={`translate(${p.x} ${p.y}) rotate(${p.r} ${w / 2} ${h / 2})`}
            >
              <Shade id={j.id} deep={p.deep} />
              <use
                href={`#${artId(j.id)}`}
                className={cn(
                  "transition-opacity duration-150 ease-out",
                  focus &&
                    !on &&
                    (morph
                      ? "opacity-[calc(1-0.65*var(--desk-p,0))]"
                      : "opacity-35"),
                )}
              />
              <rect
                x="-14"
                y="-14"
                width={o.w + 28}
                height={o.h + 28}
                rx="16"
                fill="none"
                stroke="var(--color-fd-ring)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                className={cn(
                  "transition-opacity duration-150 ease-out",
                  !on
                    ? "opacity-0"
                    : morph
                      ? "opacity-(--desk-p)"
                      : "opacity-100",
                )}
              />
            </g>
          );
        })}
      </svg>
      {markers && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            morph && "opacity-[calc(1-min(1,var(--desk-p,0)*2))]",
          )}
        >
          {JOBS.map((j, i) => {
            const { p } = box(j.id);
            const on = focus === j.id;
            return (
              <span
                key={j.id}
                className={cn(
                  "absolute grid size-5 -translate-1/2 place-items-center rounded-full border border-transparent font-mono text-[11px] tabular-nums transition-colors duration-150 ease-out sm:size-7 sm:text-[13px]",
                  on
                    ? "bg-fd-primary text-fd-primary-foreground"
                    : "bg-fd-card text-fd-foreground shadow-ring",
                )}
                style={{ left: pct(p.x + 6, L.W), top: pct(p.y + 4, L.H) }}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      )}
      {(onPointAt || onPick) && (
        <div aria-hidden="true">
          {JOBS.map((j) => {
            const { p, w, h } = box(j.id);
            return (
              <button
                key={j.id}
                type="button"
                tabIndex={-1}
                className="absolute cursor-pointer rounded-xl [-webkit-tap-highlight-color:transparent]"
                style={{
                  left: pct(p.x, L.W),
                  top: pct(p.y, L.H),
                  width: pct(w, L.W),
                  height: pct(h, L.H),
                  transform: `rotate(${p.r}deg)`,
                }}
                onPointerEnter={() => onPointAt?.(j.id)}
                onPointerLeave={() => onPointAt?.(null)}
                onClick={() => onPick?.(j.id)}
              />
            );
          })}
          {JOBS.map((j) => {
            const { p } = box(j.id);
            return (
              <span
                key={j.id}
                className={cn(
                  "pointer-events-none absolute z-10 -translate-y-1/2 rounded-md bg-fd-foreground px-2 py-1 text-[13px] font-semibold whitespace-nowrap text-fd-background transition-opacity duration-150 ease-out max-sm:hidden",
                  tag === j.id ? "opacity-100" : "opacity-0",
                )}
                style={{
                  left: `calc(${pct(p.x + 6, L.W)} + 20px)`,
                  top: pct(p.y + 4, L.H),
                }}
              >
                {j.name()}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One desk object alone, as a pictogram (the figure key, the phone bar, the phone section heads). */
export function DeskIcon({ id, className }: { id: JobId; className?: string }) {
  const o = DESK_OBJECTS[id];
  return (
    <svg
      viewBox={o.vb.join(" ")}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {o.shade.map(([x, y, w, h, rx], k) => (
        <rect
          // oxlint-disable-next-line react/no-array-index-key -- fixed shapes in a fixed order
          key={k}
          x={x + 7}
          y={y + 9}
          width={w}
          height={h}
          rx={rx}
          fill="var(--desk-shadow)"
        />
      ))}
      <use href={`#${artId(id)}`} />
    </svg>
  );
}
