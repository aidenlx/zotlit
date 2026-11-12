// The camera of a docs-walk clip: the part of the window each frame of the
// clip shows. The recorder logs where each action of the clip happens
// (`camera.json` beside the frames); `planCamera` turns that log into a
// track, and the encoder crops every frame to the track's view. A track file
// `<slug>.camera/<name>.json` beside the walk replaces the planned track of
// one clip. See packages/e2e/AGENTS.md, "Docs walks".

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

export interface CameraPlanOptions {
  /** The zoom that frames a click or typing. @default 2 */
  zoom?: number;
  /** How long the opening shot of the whole window holds, at least. @default 0.7 */
  openHold?: number;
  /** How long before a click the camera arrives. @default 0.15 */
  lead?: number;
  /** How long one camera move takes. @default 0.6 */
  ease?: number;
  /** The shortest move, when an action leaves less time. @default 0.35 */
  minEase?: number;
  /**
   * The part of the view, as a share of each side, that an action may fall
   * in before the camera moves. @default 0.6
   */
  central?: number;
  /** The margin kept around an element or a look region, in CSS px. @default 32 */
  padding?: number;
}

const defaults = {
  zoom: 2,
  openHold: 0.7,
  lead: 0.15,
  ease: 0.6,
  minEase: 0.35,
  central: 0.6,
  padding: 32,
} satisfies Required<CameraPlanOptions>;

/** Plan the camera track of a clip from its action log. */
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

  const events = input.events
    .filter((e) => e.kind !== "park")
    .toSorted((a, b) => a.t - b.t);
  for (const event of events) {
    const shot = frame(event, input.viewport, o);
    if (!shot) continue;
    const ratio = shot.view.w / current.w;
    if (
      ratio <= 1 &&
      ratio >= 0.75 &&
      inside(shot.focus, centre(current, o.central))
    )
      continue;
    if (sameView(shot.view, current)) continue;

    // A click is met `lead` before it; a look region is framed from its call.
    const arriveBy =
      event.kind === "look" ? event.t + o.ease : event.t - o.lead;
    const far =
      current.w < W &&
      Math.abs(shot.view.w - current.w) < 1 &&
      distance(shot.view, current) > current.w;
    const start = Math.max(free, arriveBy - (far ? 2 : 1) * o.ease);
    if (far && arriveBy - start >= 2 * o.minEase) {
      // A far shot at the same zoom: out to a view of both, then in.
      const step = Math.min(o.ease, (arriveBy - start) / 2);
      const wide = fit(union(current, shot.view), input.viewport, [
        1,
        W / current.w,
      ]);
      keyframes.push(
        { t: start, view: current },
        { t: start + step, view: wide },
        { t: start + 2 * step, view: shot.view },
      );
      free = start + 2 * step;
    } else {
      const length = Math.min(o.ease, Math.max(o.minEase, arriveBy - start));
      keyframes.push(
        { t: start, view: current },
        { t: start + length, view: shot.view },
      );
      free = start + length;
    }
    current = shot.view;
  }
  // The last shot holds to the end: the clip's rest on the result.
  keyframes.push({ t: Math.max(input.duration, free), view: current });
  return { keyframes };
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

/**
 * The view that frames `event` and the area that must show in it, or
 * nothing for an event the camera does not follow.
 */
function frame(
  event: CameraEvent,
  viewport: CameraPlanInput["viewport"],
  o: Required<CameraPlanOptions>,
): { view: Rect; focus: Rect } | undefined {
  switch (event.kind) {
    case "park":
      return undefined;
    case "look": {
      const focus = pad(event.rect, event.padding ?? o.padding);
      return { view: fit(focus, viewport, [1, o.zoom]), focus };
    }
    case "point": {
      // A small box about the click; the element too, when it fits the zoom.
      const mark = pad({ x: event.x, y: event.y, w: 0, h: 0 }, 48);
      const element = event.rect && pad(event.rect, o.padding);
      const focus =
        element && fits(union(element, mark), viewport, o.zoom)
          ? union(element, mark)
          : mark;
      return { view: fit(focus, viewport, [o.zoom, o.zoom]), focus };
    }
    case "type":
    case "keys": {
      // Typing frames its field at the zoom, or wider for a wide field.
      const rect = event.rect ?? {
        x: 0,
        y: 0,
        w: viewport.width,
        h: viewport.height,
      };
      const focus = pad(rect, o.padding);
      return { view: fit(focus, viewport, [1, o.zoom]), focus };
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

function distance(a: Rect, b: Rect): number {
  return Math.hypot(
    a.x + a.w / 2 - (b.x + b.w / 2),
    a.y + a.h / 2 - (b.y + b.h / 2),
  );
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
