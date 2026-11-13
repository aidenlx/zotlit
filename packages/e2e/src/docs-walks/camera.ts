// The camera of a docs-walk clip: the part of the window each frame of the
// clip shows. The recorder logs where each action of the clip happens
// (`camera.json` beside the frames); `planCamera` turns that log into a
// track, and the encoder crops every frame to the track's view. A track file
// `<slug>.camera/<name>.json` beside the walk replaces the planned track of
// one clip. See packages/e2e/AGENTS.md, "Docs walks".

import { defaultClipSettings } from "./clip-settings.ts";
import type { ClipSettings } from "./clip-settings.ts";

/** A rectangle in the window's CSS px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One action of a clip, at `t` clip seconds (from its first frame). `rect`
 * is the area the action concerns, in CSS px.
 */
export type CameraEvent =
  /** A click mark at `x`, `y`, on the element `rect` when there is one. */
  | { kind: "point"; t: number; x: number; y: number; rect?: Rect }
  /** A pointer move without a click. The camera does not follow it. */
  | { kind: "park"; t: number; x: number; y: number }
  /** Typing from `t` to `end` into the input `rect`. */
  | { kind: "type"; t: number; end: number; rect: Rect }
  /** Typing from `t` to `end`, with the caret or focused element in `rect`. */
  | { kind: "keys"; t: number; end: number; rect?: Rect }
  /** A region to frame without a pointer move, such as a step's result. */
  | { kind: "look"; t: number; rect: Rect; padding?: number };

/**
 * The view at each keyframe, in clip seconds. Between two keyframes with
 * different views the camera eases in and out; between equal views it holds.
 * Before the first keyframe and after the last, the view stands.
 */
export interface CameraTrack {
  keyframes: { t: number; view: Rect }[];
}

export interface CameraPlanInput {
  /** The window size, in CSS px; every view keeps its ratio. */
  viewport: { width: number; height: number };
  /** The clip's length in seconds. */
  duration: number;
  events: readonly CameraEvent[];
}

/** The planner's settings; see {@link ClipSettings} for each one. */
export type CameraPlanOptions = Partial<
  Pick<
    ClipSettings,
    | "zoom"
    | "hold"
    | "openHold"
    | "lead"
    | "ease"
    | "minEase"
    | "central"
    | "context"
    | "padding"
  >
>;

const defaults: Required<CameraPlanOptions> = {
  zoom: defaultClipSettings.zoom,
  hold: defaultClipSettings.hold,
  openHold: defaultClipSettings.openHold,
  lead: defaultClipSettings.lead,
  ease: defaultClipSettings.ease,
  minEase: defaultClipSettings.minEase,
  central: defaultClipSettings.central,
  context: defaultClipSettings.context,
  padding: defaultClipSettings.padding,
};

/** A zoom in narrows the view to this share of its width or less. */
const ZOOM_IN = 0.8;

/**
 * Plan the camera track of a clip from its action log. The camera prefers
 * the whole window and moves seldom: each shot holds at least `hold` after
 * its move, and frames every action that comes before the next move could
 * arrive. It zooms in, to `zoom` at most, only on a group of actions that
 * the current view shows and that a tighter shot can hold; when an action
 * falls outside the view, it widens to a view of both.
 */
export function planCamera(
  input: CameraPlanInput,
  options: CameraPlanOptions = {},
): CameraTrack {
  const o = { ...defaults, ...options };
  const { width: W, height: H } = input.viewport;
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const keyframes: CameraTrack["keyframes"] = [{ t: 0, view: full }];
  let current = full;
  /** The earliest time the next move may start. */
  let free = o.openHold;
  /** When the last move arrived. */
  let arrived = 0;
  /** The end of the last action the current shot shows. */
  let busy = 0;

  const actions = input.events
    .flatMap((e) => frame(e, input.viewport, o) ?? [])
    .toSorted((a, b) => a.t - b.t);
  for (const [i, next] of actions.entries()) {
    const start = Math.max(free, busy, next.by - o.ease);
    const length = Math.min(o.ease, Math.max(o.minEase, next.by - start));
    const arrive = start + length;
    // The shot holds `hold`, so it shows every action due before the move
    // after it could arrive.
    const group = actions
      .slice(i)
      .filter((a) => a.by < arrive + o.hold + o.ease);
    const shot = fit(group.map((a) => a.frame).reduce(union), input.viewport, [
      1,
      o.zoom,
    ]);
    const shown = inside(next.need, centre(current, o.central));
    const view = !shown
      ? // Out of view: a view of both, rather than a pan at the zoom.
        fit(union(current, shot), input.viewport, [1, o.zoom])
      : // A zoom in takes its whole `ease`, before the action.
        shot.w <= ZOOM_IN * current.w && next.by - start >= o.ease
        ? shot
        : undefined;
    if (!view || sameView(view, current)) {
      busy = Math.max(busy, next.end);
      continue;
    }
    keyframes.push({ t: start, view: current }, { t: arrive, view });
    current = view;
    arrived = arrive;
    free = arrive + o.hold;
    busy = next.end;
  }
  // The last shot holds to the end: the clip's rest on the result.
  keyframes.push({ t: Math.max(input.duration, arrived), view: current });
  return { keyframes };
}

/**
 * How long the encoder holds the last frame of a clip `duration` s long cut
 * with `track`: `endPad`, or longer, so the shot after the last move rests
 * `hold` at least.
 */
export function closingPad(
  track: CameraTrack,
  duration: number,
  { endPad, hold }: Pick<ClipSettings, "endPad" | "hold">,
): number {
  const keys = track.keyframes;
  let arrival: number | undefined;
  for (let i = 1; i < keys.length; i++)
    if (
      keys[i]!.t > keys[i - 1]!.t &&
      !sameView(keys[i - 1]!.view, keys[i]!.view)
    )
      arrival = keys[i]!.t;
  return arrival === undefined
    ? endPad
    : Math.max(endPad, hold - (duration - arrival));
}

/**
 * How long the encoder holds the first frame of a clip whose first shot is
 * cut with `track`: `openPad`, or longer, so the opening shot rests `hold` at
 * least before the first move starts or the clip cuts to its next shot.
 * @param cut when the first shot ends and the next begins, in s; none for a
 *   clip of one shot.
 */
export function openingPad(
  track: CameraTrack,
  { openPad, hold }: Pick<ClipSettings, "openPad" | "hold">,
  cut = Infinity,
): number {
  const keys = track.keyframes;
  let change = cut;
  for (let i = 1; i < keys.length; i++)
    if (
      keys[i]!.t > keys[i - 1]!.t &&
      !sameView(keys[i - 1]!.view, keys[i]!.view)
    ) {
      change = Math.min(change, keys[i - 1]!.t);
      break;
    }
  return change === Infinity ? openPad : Math.max(openPad, hold - change);
}

/** The view of `track` at `t` clip seconds. */
export function viewAt(track: CameraTrack, t: number): Rect {
  const keys = track.keyframes;
  if (keys.length === 0) throw new Error("a camera track needs a keyframe");
  if (t <= keys[0]!.t) return keys[0]!.view;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t >= b.t) continue;
    const a = keys[i - 1]!;
    const p = b.t > a.t ? easeInOut((t - a.t) / (b.t - a.t)) : 1;
    const mix = (u: number, v: number) => u + (v - u) * p;
    return {
      x: mix(a.view.x, b.view.x),
      y: mix(a.view.y, b.view.y),
      w: mix(a.view.w, b.view.w),
      h: mix(a.view.h, b.view.h),
    };
  }
  return keys.at(-1)!.view;
}

/** An action the camera follows, as {@link planCamera} plans it. */
interface Action {
  t: number;
  /** When the camera is to arrive: `lead` before a click or typing. */
  by: number;
  /** When the action ends. */
  end: number;
  /** The area that must show in the view. */
  need: Rect;
  /** The area a shot of the action frames: `need` with its context. */
  frame: Rect;
}

/**
 * The action that `event` is to the camera, or nothing for an event the
 * camera does not follow. Every area is clipped to the window.
 */
function frame(
  event: CameraEvent,
  viewport: CameraPlanInput["viewport"],
  o: Required<CameraPlanOptions>,
): Action | undefined {
  const whole = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  const clip = (r: Rect) => meet(r, whole) ?? whole;
  switch (event.kind) {
    case "park":
      return undefined;
    case "look": {
      // A look region is framed from its call, as the walk chose it.
      const need = clip(pad(event.rect, event.padding ?? o.padding));
      return {
        t: event.t,
        by: event.t + o.ease,
        end: event.t,
        need,
        frame: need,
      };
    }
    case "point": {
      // A small box about the click; the element too, when it fits the zoom.
      const mark = pad({ x: event.x, y: event.y, w: 0, h: 0 }, 48);
      const element = event.rect && pad(event.rect, o.padding);
      const need = clip(
        element && fits(union(element, mark), viewport, o.zoom)
          ? union(element, mark)
          : mark,
      );
      return {
        t: event.t,
        by: event.t - o.lead,
        end: event.t,
        need,
        frame: clip(pad(need, o.context)),
      };
    }
    case "type":
    case "keys": {
      // Only the part of the field inside the window counts.
      const need = clip(pad(event.rect ?? whole, o.padding));
      return {
        t: event.t,
        by: event.t - o.lead,
        end: event.end,
        need,
        frame: clip(pad(need, o.context)),
      };
    }
  }
}

/**
 * The view of the window's ratio, clamped inside it, that holds `rect` at a
 * zoom between `minZoom` and `maxZoom`, centred on `rect` where it can be.
 */
function fit(
  rect: Rect,
  viewport: CameraPlanInput["viewport"],
  [minZoom, maxZoom]: readonly [number, number],
): Rect {
  const { width: W, height: H } = viewport;
  const need = Math.max(rect.w, (rect.h * W) / H);
  const w = Math.min(W / minZoom, Math.max(W / maxZoom, need));
  const h = (w * H) / W;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    x: clamp(cx - w / 2, 0, W - w),
    y: clamp(cy - h / 2, 0, H - h),
    w,
    h,
  };
}

function fits(
  rect: Rect,
  viewport: CameraPlanInput["viewport"],
  zoom: number,
): boolean {
  return rect.w <= viewport.width / zoom && rect.h <= viewport.height / zoom;
}

/** The central part of `view`, `share` of each side. */
function centre(view: Rect, share: number): Rect {
  const w = view.w * share;
  const h = view.h * share;
  return { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h };
}

function inside(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
  );
}

/** The part of `a` inside `b`, or undefined when they do not meet. */
function meet(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function pad(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function sameView(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.w - b.w) < 1 &&
    Math.abs(a.h - b.h) < 1
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}
