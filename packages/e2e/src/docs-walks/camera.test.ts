import { describe, expect, it } from "vitest";

import { closingPad, planCamera, viewAt } from "./camera.ts";
import type {
  CameraEvent,
  CameraPlanOptions,
  CameraTrack,
  Rect,
} from "./camera.ts";

const viewport = { width: 1440, height: 860 };
const full: Rect = { x: 0, y: 0, w: 1440, h: 860 };
/** The planner settings of these cases, apart from the defaults. */
const options: Required<CameraPlanOptions> = {
  zoom: 2,
  hold: 2,
  openHold: 1,
  lead: 0.5,
  ease: 1,
  minEase: 0.5,
  central: 1,
  context: 150,
  padding: 20,
};
/** The width of a view at the highest zoom, 2x. */
const tight = 720;

function plan(events: CameraEvent[], duration = 8): CameraTrack {
  return planCamera({ viewport, duration, events }, options);
}

/** Every view the track passes through, sampled every 10 ms. */
function sampled(track: CameraTrack, duration: number): Rect[] {
  const views: Rect[] = [];
  for (let t = 0; t <= duration; t += 0.01) views.push(viewAt(track, t));
  return views;
}

/** The start time of each move of the track. */
function moves(track: CameraTrack): number[] {
  const keys = track.keyframes;
  const starts: number[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const still =
      Math.abs(a.view.x - b.view.x) < 1 &&
      Math.abs(a.view.y - b.view.y) < 1 &&
      Math.abs(a.view.w - b.view.w) < 1;
    if (b.t > a.t && !still) starts.push(a.t);
  }
  return starts;
}

function shows(view: Rect, x: number, y: number): boolean {
  return (
    x >= view.x && y >= view.y && x <= view.x + view.w && y <= view.y + view.h
  );
}

describe("planCamera", () => {
  it("holds the whole window, then meets a click at the highest zoom `lead` before it", () => {
    const track = plan([{ kind: "point", t: 4, x: 700, y: 400 }]);
    expect(viewAt(track, 0)).toEqual(full);
    expect(viewAt(track, 2.49)).toEqual(full);
    expect(viewAt(track, 3.5)).toEqual({ x: 340, y: 185, w: 720, h: 430 });
    // The move takes the whole `ease`, from 2.5 s.
    expect(viewAt(track, 3).w).toBeGreaterThan(tight + 10);
  });

  it("keeps the whole window for a click it cannot meet with a whole move", () => {
    const track = plan([{ kind: "point", t: 1.6, x: 700, y: 400 }]);
    expect(viewAt(track, 8)).toEqual(full);
    expect(moves(track)).toEqual([]);
  });

  it("clamps the view inside the window at the window's ratio", () => {
    const track = plan([{ kind: "point", t: 4, x: 10, y: 850 }]);
    for (const v of sampled(track, 8)) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(1440 + 1e-6);
      expect(v.y + v.h).toBeLessThanOrEqual(860 + 1e-6);
      expect(v.w / v.h).toBeCloseTo(1440 / 860);
    }
    expect(viewAt(track, 8)).toEqual({ x: 0, y: 430, w: 720, h: 430 });
  });

  it("frames a run of close clicks in one shot", () => {
    const track = plan(
      [4, 4.6, 5.2, 5.8, 6.4].map((t, i) => ({
        kind: "point" as const,
        t,
        x: 900 + 60 * i,
        y: 200 + 20 * i,
        rect: { x: 880 + 60 * i, y: 190 + 20 * i, w: 40, h: 24 },
      })),
    );
    expect(moves(track)).toHaveLength(1);
    for (const t of [4, 4.6, 5.2, 5.8, 6.4])
      expect(viewAt(track, t)).toEqual(viewAt(track, 8));
    const shot = viewAt(track, 8);
    expect(shows(shot, 900, 200)).toBe(true);
    expect(shows(shot, 1140, 280)).toBe(true);
    // The five frames with their context span 636 x 476 px, wider than a
    // shot of the first click alone.
    expect(shot.w).toBeCloseTo((476 * 1440) / 860);
  });

  it("keeps the whole window for clicks spread across it", () => {
    const track = plan([
      { kind: "point", t: 4, x: 200, y: 200 },
      { kind: "point", t: 5, x: 1300, y: 700 },
    ]);
    expect(viewAt(track, 8)).toEqual(full);
    expect(moves(track)).toEqual([]);
  });

  it("widens to a view of both for an action outside the view", () => {
    const track = plan(
      [
        { kind: "point", t: 4, x: 300, y: 300 },
        { kind: "point", t: 10, x: 1350, y: 750 },
      ],
      12,
    );
    const zoomed = viewAt(track, 4);
    expect(zoomed.w).toBeCloseTo(tight);
    const after = viewAt(track, 10);
    expect(shows(after, 300, 300)).toBe(true);
    expect(shows(after, 1350, 750)).toBe(true);
    // It widens, and never pans at the zoom.
    for (let t = 4; t <= 12; t += 0.01)
      expect(viewAt(track, t).w).toBeGreaterThanOrEqual(zoomed.w - 1e-6);
  });

  it("fits a look region with padding, between the whole window and the highest zoom", () => {
    const wide = plan([
      { kind: "look", t: 2, rect: { x: 100, y: 100, w: 1000, h: 300 } },
    ]);
    const shot = viewAt(wide, 8);
    expect(shot.w).toBeCloseTo(1040);
    expect(shot.x).toBeCloseTo(80);
    const small = plan([
      { kind: "look", t: 2, rect: { x: 600, y: 300, w: 40, h: 20 } },
    ]);
    expect(viewAt(small, 8).w).toBeCloseTo(tight);
    const huge = plan([
      { kind: "look", t: 2, rect: { x: 0, y: 0, w: 1440, h: 860 } },
    ]);
    expect(viewAt(huge, 8)).toEqual(full);
  });

  it("frames a look from its call and holds it to the clip's end", () => {
    const track = plan(
      [{ kind: "look", t: 4, rect: { x: 100, y: 100, w: 1000, h: 300 } }],
      7,
    );
    expect(viewAt(track, 4)).toEqual(full);
    expect(viewAt(track, 5).w).toBeCloseTo(1040);
    expect(viewAt(track, 7)).toEqual(viewAt(track, 5));
    expect(track.keyframes.at(-1)!.t).toBe(7);
  });

  it("frames a typing field with its context, the whole window for a wide one", () => {
    const narrow = plan([
      { kind: "type", t: 4, end: 5, rect: { x: 300, y: 80, w: 200, h: 40 } },
    ]);
    expect(viewAt(narrow, 8)).toEqual({ x: 40, y: 0, w: 720, h: 430 });
    // The field and its padding are 940 px wide; with the context, 1240 px.
    const wide = plan([
      { kind: "type", t: 4, end: 5, rect: { x: 300, y: 80, w: 900, h: 40 } },
    ]);
    expect(viewAt(wide, 8)).toEqual(full);
  });

  it("frames only the part of a typing field inside the window", () => {
    const track = plan([
      { kind: "keys", t: 4, end: 5, rect: { x: 400, y: 600, w: 300, h: 900 } },
    ]);
    const shot = viewAt(track, 8);
    expect(shot.w).toBeCloseTo(tight);
    expect(shot.y + shot.h).toBeCloseTo(860);
  });

  it("does not follow a park", () => {
    const track = plan([{ kind: "park", t: 2, x: 1400, y: 840 }]);
    expect(viewAt(track, 8)).toEqual(full);
  });
});

describe("closingPad", () => {
  const settings = { endPad: 0.5, hold: 3 };
  const zoomed: Rect = { x: 360, y: 215, w: 720, h: 430 };

  it("rests the closing zoom onto a result at least the hold", () => {
    // The zoom arrives at 5 s, 1 s before the end of a 6 s clip.
    const track: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 4, view: full },
        { t: 5, view: zoomed },
        { t: 6, view: zoomed },
      ],
    };
    expect(closingPad(track, 6, settings)).toBeCloseTo(2);
  });

  it("keeps the end pad after a long closing shot or none", () => {
    const long: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 2.5, view: full },
        { t: 3.5, view: zoomed },
        { t: 12, view: zoomed },
      ],
    };
    expect(closingPad(long, 12, settings)).toBe(0.5);
    const still: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 6, view: full },
      ],
    };
    expect(closingPad(still, 6, settings)).toBe(0.5);
  });
});

describe("viewAt", () => {
  it("eases between keyframes and stands outside them", () => {
    const a: Rect = { x: 0, y: 0, w: 1440, h: 860 };
    const b: Rect = { x: 100, y: 100, w: 720, h: 430 };
    const track: CameraTrack = {
      keyframes: [
        { t: 1, view: a },
        { t: 2, view: b },
      ],
    };
    expect(viewAt(track, 0)).toEqual(a);
    expect(viewAt(track, 3)).toEqual(b);
    const mid = viewAt(track, 1.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.w).toBeCloseTo(1080);
    // Ease in: slower than linear at the start.
    expect(viewAt(track, 1.1).x).toBeLessThan(10);
  });
});
