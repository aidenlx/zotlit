import { describe, expect, it } from "vitest";

import { planCamera, viewAt } from "./camera.ts";
import type { CameraEvent, CameraTrack, Rect } from "./camera.ts";
import { defaultClipSettings } from "./clip-settings.ts";

const viewport = { width: 1440, height: 860 };
const full: Rect = { x: 0, y: 0, w: 1440, h: 860 };
/** The width of a view at the highest zoom. */
const tight = 1440 / defaultClipSettings.zoom;

function plan(events: CameraEvent[], duration = 8): CameraTrack {
  return planCamera({ viewport, duration, events });
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

/** The action log of Lesson 1 step 1, the install from the community directory. */
const install: CameraEvent[] = [
  {
    kind: "point",
    t: 1.6,
    x: 322,
    y: 840,
    rect: { x: 308, y: 828, w: 28, h: 24 },
  },
  { kind: "look", t: 1.76, rect: { x: 170, y: 65, w: 1100, h: 731 } },
  {
    kind: "point",
    t: 2.97,
    x: 296,
    y: 379,
    rect: { x: 183, y: 366, w: 225, h: 25 },
  },
  {
    kind: "point",
    t: 3.72,
    x: 1100,
    y: 373,
    rect: { x: 1026, y: 358, w: 149, h: 30 },
  },
  {
    kind: "point",
    t: 5.1,
    x: 1141,
    y: 225,
    rect: { x: 1107, y: 210, w: 68, h: 30 },
  },
  {
    kind: "point",
    t: 7.84,
    x: 243,
    y: 93,
    rect: { x: 183, y: 78, w: 432, h: 30 },
  },
  { kind: "type", t: 7.99, end: 8.66, rect: { x: 183, y: 78, w: 432, h: 30 } },
  {
    kind: "point",
    t: 9.26,
    x: 303,
    y: 288,
    rect: { x: 183, y: 189, w: 260, h: 197 },
  },
  { kind: "look", t: 9.73, rect: { x: 491, y: 106, w: 738, h: 282 } },
  {
    kind: "point",
    t: 10.93,
    x: 546,
    y: 356,
    rect: { x: 516, y: 341, w: 60, h: 30 },
  },
  {
    kind: "point",
    t: 15.93,
    x: 548,
    y: 356,
    rect: { x: 516, y: 341, w: 65, h: 30 },
  },
  {
    kind: "point",
    t: 17.49,
    x: 1251,
    y: 84,
    rect: { x: 1239, y: 72, w: 24, h: 24 },
  },
  { kind: "park", t: 18.54, x: 1040, y: 504 },
  { kind: "look", t: 18.54, rect: { x: 344, y: 78, w: 756, h: 450 } },
];

/** Clicks every 0.7 s, back and forth across the window. */
const busy: CameraEvent[] = Array.from({ length: 26 }, (_, i) => ({
  kind: "point" as const,
  t: 1.6 + 0.7 * i,
  x: [120, 1320, 700, 200, 1250][i % 5]!,
  y: [100, 760, 430, 700, 120][i % 5]!,
  rect: {
    x: [100, 1300, 680, 180, 1230][i % 5]!,
    y: [90, 750, 420, 690, 110][i % 5]!,
    w: 40,
    h: 24,
  },
}));

describe("planCamera", () => {
  it("holds the whole window, then meets a click at 1.4x half a second before it", () => {
    const track = plan([{ kind: "point", t: 4, x: 700, y: 400 }]);
    expect(viewAt(track, 0)).toEqual(full);
    expect(viewAt(track, 2.49)).toEqual(full);
    const at = viewAt(track, 3.5);
    expect(at.w).toBeCloseTo(tight);
    expect(at.h).toBeCloseTo(860 / defaultClipSettings.zoom);
    expect(at.x + at.w / 2).toBeCloseTo(700);
    expect(at.y + at.h / 2).toBeCloseTo(400);
    // The move takes a whole second.
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
    const end = viewAt(track, 8);
    expect(end.x).toBe(0);
    expect(end.y + end.h).toBeCloseTo(860);
    expect(end.w).toBeCloseTo(tight);
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
  });

  it("keeps the whole window for clicks spread across it", () => {
    const track = plan([
      { kind: "point", t: 4, x: 200, y: 200 },
      { kind: "point", t: 5, x: 1300, y: 700 },
    ]);
    expect(viewAt(track, 8)).toEqual(full);
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

  it("fits a look region with padding, between 1x and 1.4x", () => {
    const wide = plan([
      { kind: "look", t: 2, rect: { x: 100, y: 100, w: 1000, h: 300 } },
    ]);
    const shot = viewAt(wide, 8);
    expect(shot.w).toBeCloseTo(1064);
    expect(shot.x).toBeLessThanOrEqual(68);
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
      [
        { kind: "point", t: 2, x: 700, y: 400 },
        { kind: "look", t: 4, rect: { x: 100, y: 100, w: 1000, h: 300 } },
      ],
      7,
    );
    expect(viewAt(track, 4)).toEqual(full);
    expect(viewAt(track, 5).w).toBeCloseTo(1064);
    expect(viewAt(track, 7)).toEqual(viewAt(track, 5));
    expect(track.keyframes.at(-1)!.t).toBe(7);
  });

  it("frames a typing field with its context, the whole window for a wide one", () => {
    const narrow = plan([
      { kind: "type", t: 4, end: 5, rect: { x: 300, y: 80, w: 200, h: 40 } },
    ]);
    const shot = viewAt(narrow, 8);
    expect(shot.w).toBeCloseTo(tight);
    expect(shot.x).toBeLessThanOrEqual(300 - 32 - 160);
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

  describe("keeps the camera calm", () => {
    /** Small targets in alternating corners, 4.5 s apart. */
    const corners: CameraEvent[] = [4, 8.5, 13, 17.5].map((t, i) => ({
      kind: "point" as const,
      t,
      x: [150, 1290, 150, 1290][i]!,
      y: [120, 740, 740, 120][i]!,
    }));
    const logs = { install, busy, corners };

    it("moves between corners no sooner than the hold allows", () => {
      const starts = moves(plan(corners, 21));
      expect(starts.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < starts.length; i++)
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(
          defaultClipSettings.hold,
        );
    });

    it.each(Object.entries(logs))("zooms to 1.4x at most (%s)", (_, events) => {
      const track = plan(events, 21);
      for (const v of sampled(track, 21))
        expect(v.w).toBeGreaterThanOrEqual(tight - 1e-6);
    });

    it.each(Object.entries(logs))(
      "starts no two moves less than the hold apart (%s)",
      (_, events) => {
        const starts = moves(plan(events, 21));
        expect(starts[0] ?? Infinity).toBeGreaterThanOrEqual(
          defaultClipSettings.openHold,
        );
        for (let i = 1; i < starts.length; i++)
          expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(
            defaultClipSettings.hold,
          );
      },
    );

    it.each(Object.entries(logs))(
      "shows each click at its time (%s)",
      (_, events) => {
        const track = plan(events, 21);
        const hidden = events.filter(
          (e) => e.kind === "point" && !shows(viewAt(track, e.t), e.x, e.y),
        );
        expect(hidden).toEqual([]);
      },
    );

    it("moves at most three times in the 20 s install", () => {
      expect(moves(plan(install, 20.67)).length).toBeLessThanOrEqual(3);
    });
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
