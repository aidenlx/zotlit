import { describe, expect, it } from "vitest";

import { closingPad, openingPad, planCamera, viewAt } from "./camera.ts";
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

  it("widens a zoomed shot to one still view of both ends of a far drag", () => {
    // The click at the centre zooms in to 720 x 430. The drag starts there
    // and drops at the bottom left, outside that shot.
    const track = plan(
      [
        { kind: "point", t: 3.5, x: 720, y: 430 },
        {
          kind: "drag",
          t: 7,
          end: 8,
          from: { x: 720, y: 430 },
          to: { x: 60, y: 800 },
        },
      ],
      10,
    );
    expect(viewAt(track, 3.5)).toEqual({ x: 360, y: 215, w: 720, h: 430 });
    // The drop's mark with its context reaches the window's left and bottom
    // edges; with the zoomed shot, the view spans x 0-1080 and y 215-860.
    const view = { x: 0, y: 215, w: 1080, h: 645 };
    // The view is in place `lead` before the press and stays to the release.
    for (let t = 6.5; t <= 8; t += 0.01) expect(viewAt(track, t)).toEqual(view);
    expect(shows(view, 720, 430)).toBe(true);
    expect(shows(view, 60, 800)).toBe(true);
  });

  it("frames a drag whose ends fit the zoom in one still zoomed shot", () => {
    const track = plan([
      {
        kind: "drag",
        t: 4,
        end: 5,
        from: { x: 600, y: 400 },
        to: { x: 840, y: 460 },
      },
    ]);
    // Both marks with their context span x 402-1038 and y 202-658, 636 x 456
    // px: at the window's ratio, 763.5 x 456 px, centred on (720, 430).
    const w = (456 * 1440) / 860;
    expect(moves(track)).toEqual([2.5]);
    for (let t = 3.5; t <= 5; t += 0.01) {
      const v = viewAt(track, t);
      expect(v.x).toBeCloseTo(720 - w / 2);
      expect(v.y).toBeCloseTo(202);
      expect(v.w).toBeCloseTo(w);
      expect(v.h).toBeCloseTo(456);
    }
    expect(shows(viewAt(track, 4), 600, 400)).toBe(true);
    expect(shows(viewAt(track, 4), 840, 460)).toBe(true);
  });
});

// PR #2012: a drag's view stands from `lead` before the press to the release.
describe("planCamera, a drag at the clip defaults", () => {
  /** The defaults of clip-settings.ts, written out so these cases hold. */
  const calm: Required<CameraPlanOptions> = {
    zoom: 1.4,
    hold: 2.5,
    openHold: 1.5,
    lead: 0.5,
    ease: 1,
    minEase: 0.6,
    central: 1,
    context: 160,
    padding: 32,
  };
  /** The 1.4x shot of a click at the centre: x 205.7-1234.3, y 122.9-737.1. */
  const centre: Rect = {
    x: 720 - 1440 / 1.4 / 2,
    y: 430 - 860 / 1.4 / 2,
    w: 1440 / 1.4,
    h: 860 / 1.4,
  };
  /**
   * That shot widened to the window's left and bottom edges, where the
   * context of a drop at the bottom left reaches: x 0-1234.3, y 122.9-860.
   */
  const widened: Rect = {
    x: 0,
    y: centre.y,
    w: centre.x + centre.w,
    h: 860 - centre.y,
  };

  function planCalm(events: CameraEvent[], duration: number): CameraTrack {
    return planCamera({ viewport, duration, events }, calm);
  }

  /** Assert that the view is `view` at every 10 ms from `from` to `to`. */
  function holds(
    track: CameraTrack,
    [from, to]: readonly [number, number],
    view: Rect,
  ) {
    for (let t = from; t <= to + 1e-9; t += 0.01) {
      const v = viewAt(track, t);
      expect(v.x).toBeCloseTo(view.x, 3);
      expect(v.y).toBeCloseTo(view.y, 3);
      expect(v.w).toBeCloseTo(view.w, 3);
      expect(v.h).toBeCloseTo(view.h, 3);
    }
  }

  it("widens before a drag that comes after typing ends late", () => {
    const track = planCalm(
      [
        {
          kind: "type",
          t: 4,
          end: 8.8,
          rect: { x: 650, y: 380, w: 140, h: 60 },
        },
        {
          kind: "drag",
          t: 9,
          end: 10,
          from: { x: 720, y: 430 },
          to: { x: 60, y: 800 },
        },
      ],
      12,
    );
    // The field with its padding and context is centred on (720, 410): a
    // 1.4x shot at y 102.9-717.1.
    const typing = { ...centre, y: 410 - 860 / 1.4 / 2 };
    holds(track, [4, 4], typing);
    // Widened to the left and bottom edges: x 0-1234.3, y 102.9-860, 757.1
    // tall, so 1267.8 wide at the window's ratio.
    const h = 860 - typing.y;
    const view = { x: 0, y: typing.y, w: (h * 1440) / 860, h };
    holds(track, [8.5, 10], view);
    expect(shows(view, 720, 430)).toBe(true);
    expect(shows(view, 60, 800)).toBe(true);
  });

  it("widens before a drag pressed soon after a click, as with a short glide", () => {
    // With `glide` 0.2 s, the press comes 0.35 s after the click before it
    // (the glide and the click mark), less than `minEase`.
    const track = planCalm(
      [
        { kind: "point", t: 3.5, x: 720, y: 430 },
        { kind: "point", t: 7.3, x: 700, y: 450 },
        {
          kind: "drag",
          t: 7.65,
          end: 8,
          from: { x: 700, y: 450 },
          to: { x: 60, y: 800 },
        },
      ],
      10,
    );
    holds(track, [3.5, 3.5], centre);
    holds(track, [7.15, 8], widened);
  });

  it("widens for a drag whose ends show but whose context does not", () => {
    const track = planCalm(
      [
        { kind: "point", t: 4, x: 720, y: 430 },
        {
          kind: "drag",
          t: 10,
          end: 11,
          from: { x: 300, y: 250 },
          to: { x: 1140, y: 650 },
        },
      ],
      12,
    );
    holds(track, [4, 4], centre);
    // Both ends with their context span x 92-1348 and y 42-858, 1256 x 816
    // px: at the window's ratio, 1366.3 x 816, centred on x 720.
    const w = (816 * 1440) / 860;
    holds(track, [9.5, 11], { x: 720 - w / 2, y: 42, w, h: 816 });
  });

  it("folds a move that cannot arrive before the press into the shot before it", () => {
    // The typing at the centre ends at 7.3 s, so the widening for the click
    // at the bottom left starts then and arrives at 7.9 s: after 7.45 s,
    // `lead` before the press of the drag that follows the click.
    const track = planCalm(
      [
        {
          kind: "type",
          t: 4,
          end: 7.3,
          rect: { x: 650, y: 400, w: 140, h: 60 },
        },
        { kind: "point", t: 7.6, x: 60, y: 800 },
        {
          kind: "drag",
          t: 7.95,
          end: 8.3,
          from: { x: 60, y: 800 },
          to: { x: 400, y: 800 },
        },
      ],
      10,
    );
    // The centre shot of the typing takes the widened view at once.
    holds(track, [3.5, 8.3], widened);
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

describe("openingPad", () => {
  const settings = { openPad: 0.8, hold: 2.5 };
  const zoomed: Rect = { x: 360, y: 215, w: 720, h: 430 };

  it("rests the opening shot at least the hold before the first move", () => {
    // The first move starts at 1.5 s, so the pad grows from 0.8 s to 1 s.
    const track: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 1.5, view: full },
        { t: 2.5, view: zoomed },
        { t: 6, view: zoomed },
      ],
    };
    expect(openingPad(track, settings)).toBeCloseTo(1);
  });

  it("keeps the open pad before a late first move or none", () => {
    const late: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 3, view: full },
        { t: 4, view: zoomed },
        { t: 6, view: zoomed },
      ],
    };
    expect(openingPad(late, settings)).toBe(0.8);
    const still: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 6, view: full },
      ],
    };
    expect(openingPad(still, settings)).toBe(0.8);
  });

  it("rests the opening shot the hold before a cut to the next shot", () => {
    // A first shot 1.2 s long with no camera move: the pad grows to 1.3 s.
    const still: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 1.2, view: full },
      ],
    };
    expect(openingPad(still, settings, 1.2)).toBeCloseTo(1.3);
    // A move at 0.5 s comes before a cut at 3 s, so the move sets the rest.
    const early: CameraTrack = {
      keyframes: [
        { t: 0, view: full },
        { t: 0.5, view: full },
        { t: 1.5, view: zoomed },
        { t: 3, view: zoomed },
      ],
    };
    expect(openingPad(early, settings, 3)).toBeCloseTo(2);
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
