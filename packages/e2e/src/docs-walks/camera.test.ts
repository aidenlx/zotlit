import { describe, expect, it } from "vitest";

import { planCamera, viewAt } from "./camera.ts";
import type { CameraEvent, CameraTrack, Rect } from "./camera.ts";

const viewport = { width: 1440, height: 860 };
const full: Rect = { x: 0, y: 0, w: 1440, h: 860 };

function plan(events: CameraEvent[], duration = 6): CameraTrack {
  return planCamera({ viewport, duration, events });
}

/** Every view the track passes through, sampled every 10 ms. */
function sampled(track: CameraTrack, duration: number): Rect[] {
  const views: Rect[] = [];
  for (let t = 0; t <= duration; t += 0.01) views.push(viewAt(track, t));
  return views;
}

describe("planCamera", () => {
  it("holds the whole window, then meets a click at 2x 150 ms before it", () => {
    const track = plan([{ kind: "point", t: 2, x: 700, y: 400 }]);
    expect(viewAt(track, 0)).toEqual(full);
    expect(viewAt(track, 0.7)).toEqual(full);
    const at = viewAt(track, 1.85);
    expect(at.w).toBeCloseTo(720);
    expect(at.h).toBeCloseTo(430);
    expect(at.x + at.w / 2).toBeCloseTo(700);
    expect(at.y + at.h / 2).toBeCloseTo(400);
    // The move starts 600 ms before it arrives.
    expect(viewAt(track, 1.24)).toEqual(full);
  });

  it("keeps the opening hold when the first click comes early", () => {
    const track = plan([{ kind: "point", t: 0.9, x: 700, y: 400 }]);
    expect(viewAt(track, 0.7)).toEqual(full);
    // It arrives late rather than cut the opening shot short.
    expect(viewAt(track, 1.3).w).toBeCloseTo(720);
    expect(viewAt(track, 1.0).w).toBeGreaterThan(720);
  });

  it("clamps the view inside the window at the window's ratio", () => {
    const track = plan([{ kind: "point", t: 2, x: 10, y: 850 }]);
    for (const v of sampled(track, 6)) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(1440 + 1e-6);
      expect(v.y + v.h).toBeLessThanOrEqual(860 + 1e-6);
      expect(v.w / v.h).toBeCloseTo(1440 / 860);
    }
    expect(viewAt(track, 6)).toEqual({ x: 0, y: 430, w: 720, h: 430 });
  });

  it("stays while the next action falls in the middle of the view", () => {
    const track = plan([
      { kind: "point", t: 2, x: 700, y: 400 },
      { kind: "point", t: 3, x: 760, y: 430 },
    ]);
    expect(viewAt(track, 3)).toEqual(viewAt(track, 1.85));
    expect(viewAt(track, 6)).toEqual(viewAt(track, 1.85));
  });

  it("pans to a near action at the same zoom", () => {
    const track = plan([
      { kind: "point", t: 2, x: 500, y: 400 },
      { kind: "point", t: 4, x: 900, y: 400 },
    ]);
    const before = viewAt(track, 2);
    const after = viewAt(track, 3.85);
    expect(after.w).toBeCloseTo(before.w);
    expect(after.x - before.x).toBeCloseTo(400);
    // No frame of the pan is wider than the shots.
    for (let t = 2; t <= 4; t += 0.01)
      expect(viewAt(track, t).w).toBeCloseTo(720);
  });

  it("zooms out between two far actions", () => {
    const track = plan([
      { kind: "point", t: 2, x: 200, y: 200 },
      { kind: "point", t: 5, x: 1300, y: 700 },
    ]);
    const widest = Math.max(
      ...sampled(track, 6)
        .slice(250)
        .map((v) => v.w),
    );
    expect(widest).toBeGreaterThan(1000);
    expect(viewAt(track, 4.85).w).toBeCloseTo(720);
  });

  it("fits a look region with padding, between 1x and 2x", () => {
    const wide = plan([
      { kind: "look", t: 2, rect: { x: 100, y: 100, w: 1000, h: 300 } },
    ]);
    const shot = viewAt(wide, 6);
    expect(shot.w).toBeCloseTo(1064);
    expect(shot.x).toBeLessThanOrEqual(68);
    const small = plan([
      { kind: "look", t: 2, rect: { x: 600, y: 300, w: 40, h: 20 } },
    ]);
    expect(viewAt(small, 6).w).toBeCloseTo(720);
    const huge = plan([
      { kind: "look", t: 2, rect: { x: 0, y: 0, w: 1440, h: 860 } },
    ]);
    expect(viewAt(huge, 6)).toEqual(full);
  });

  it("frames a look from its call and holds it to the clip's end", () => {
    const track = plan(
      [
        { kind: "point", t: 2, x: 700, y: 400 },
        { kind: "look", t: 4, rect: { x: 100, y: 100, w: 1000, h: 300 } },
      ],
      7,
    );
    expect(viewAt(track, 4).w).toBeCloseTo(720);
    expect(viewAt(track, 4.6).w).toBeCloseTo(1064);
    expect(viewAt(track, 7)).toEqual(viewAt(track, 4.6));
    expect(track.keyframes.at(-1)!.t).toBe(7);
  });

  it("frames a typing field, wider for a wide field", () => {
    const track = plan([
      { kind: "type", t: 2, end: 3, rect: { x: 300, y: 80, w: 900, h: 40 } },
    ]);
    const shot = viewAt(track, 6);
    expect(shot.w).toBeCloseTo(964);
    expect(shot.x).toBeLessThanOrEqual(268);
    expect(shot.x + shot.w).toBeGreaterThanOrEqual(1232);
  });

  it("does not follow a park", () => {
    const track = plan([{ kind: "park", t: 2, x: 1400, y: 840 }]);
    expect(viewAt(track, 6)).toEqual(full);
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
