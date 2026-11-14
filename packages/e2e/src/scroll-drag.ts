// A scroll bar drag of a long Items Layout, as a reader drags it: trusted
// input from Electron's main process presses the thumb, moves it with holds
// and a reverse, and lets go. Two rules of Chromium decide such a drag. The
// list's scroll length must stay one number while the pointer moves the
// thumb: a change of any size makes Chromium keep the distance the thumb was
// behind at that moment, so the thumb leaves the pointer and stays off it in
// a hold. And only what the box paints itself is sure to be on the screen:
// a drag moves the content further each frame than the page can paint.
//
// The record reads both, frame by frame: the scroll length and the thumb
// against the pointer from the page, and the screen frames of the box from
// the window's compositor output.
import type { MarkdownView } from "obsidian";

import { obRun } from "./obsidian-cli.ts";

/** Where the list scrolls: the Library View, a Query File tab, or an embed in a note's mode. */
export type DragHost =
  | { readonly kind: "library" }
  | { readonly kind: "tab"; readonly path: string }
  | { readonly kind: "note"; readonly path: string; readonly root: string };

/**
 * One leg of a drag: the pointer goes to `to`, a fraction of the track, in
 * `ms`; a leg to the fraction the pointer stands at holds it there.
 */
export type DragLeg = readonly [to: number, ms: number];

/**
 * A fast leg down, where the list moves several screens a frame; a hold; a
 * slow leg on down, a few rows a frame; a hold; a fast leg back up; a hold.
 */
export const DRAG_PATH: readonly DragLeg[] = [
  [0.35, 150],
  [0.35, 400],
  [0.7, 1200],
  [0.7, 400],
  [0.4, 200],
  [0.4, 500],
];

/** What a drag did, frame by frame. */
export interface DragRecord {
  /** The box's scroll length and height, in CSS px. */
  readonly box: { readonly length: number; readonly height: number };
  /** The thumb's length, read from a plain box of the same size and length. */
  readonly thumb: number;
  /** The thumb's offset from the pointer at the end of each hold, in pt. */
  readonly holds: readonly number[];
  /** The most the thumb stood off the pointer on a frame while it moved, in pt. */
  readonly moving: number;
  /** The changes of the scroll length while the pointer moved, and while it held still. */
  readonly lengthChanges: { readonly moving: number; readonly resting: number };
  /**
   * For each leg, the fewest and the most entries mounted on its frames, and
   * its screen frames: how many, and how many showed nothing in the box.
   */
  readonly legs: readonly {
    readonly to: number;
    readonly fewest: number;
    readonly most: number;
    readonly frames: number;
    readonly empty: number;
  }[];
  /**
   * The screen frames of the box from the first move to the release: how
   * many, how many showed nothing in the box at all, neither rows nor
   * outlines, and the largest share of the box one frame left blank.
   */
  readonly screen: {
    readonly frames: number;
    readonly empty: number;
    readonly blankShare: number;
  };
  /** Each set of header cell places the drag drew (a Table's), or none. */
  readonly header: readonly string[];
  /**
   * The mounted rows at rest after the drag: how many, and how many draw at
   * another height than the outline's row height on the box.
   */
  readonly rows: { readonly mounted: number; readonly unlike: number };
}

/** The boxes that scroll an Items Layout's rows. */
const BOXES =
  '[data-query-layout="papers"], [data-query-layout="list"], .zt-table-scroller';

/**
 * Drag the scroll bar of the long list `host` shows along `path`, and record
 * what each frame did. The host's tab is active and its list drawn.
 */
export async function dragScrollBar(
  vaultId: string,
  host: DragHost,
  path: readonly DragLeg[] = DRAG_PATH,
): Promise<DragRecord> {
  const json = await obRun(
    vaultId,
    async ({ app }, { host, boxes, path }) => {
      const remote =
        require("@electron/remote") as typeof import("@electron/remote");
      const scope = (() => {
        if (host.kind === "library")
          return app.workspace.getLeavesOfType("zotlit-library")[0]?.view
            .containerEl;
        const leaf = app.workspace
          .getLeavesOfType(
            host.kind === "tab" ? "zotlit-query-file" : "markdown",
          )
          .find((l) => (l.view as MarkdownView).file?.path === host.path);
        const el = leaf?.view.containerEl;
        return host.kind === "note" ? el?.querySelector(host.root) : el;
      })();
      const box = [...(scope?.querySelectorAll<HTMLElement>(boxes) ?? [])].find(
        (el) => el.isShown() && el.scrollHeight > el.clientHeight + 1000,
      );
      if (!box) throw new Error(`No long list in ${JSON.stringify(host)}`);
      const win = box.win;
      const doc = box.doc;
      const sleep = (ms: number) =>
        new Promise((resolve) => win.setTimeout(resolve, ms));
      const frame = () =>
        new Promise((resolve) => win.requestAnimationFrame(resolve));
      if (host.kind === "note") box.scrollIntoView({ block: "center" });
      box.scrollTop = 0;
      // The list's length settles at its top before the drag.
      for (let still = 0, last = -1, tries = 0; still < 5; tries++) {
        if (tries > 120) throw new Error("The list's length never held");
        await frame();
        still = box.scrollHeight === last ? still + 1 : 0;
        last = box.scrollHeight;
      }
      const contents = remote.getCurrentWebContents();
      const zoom = contents.getZoomFactor();
      // The vertical track starts under a Table's header.
      const trackTop =
        Number.parseFloat(
          box.style.getPropertyValue("--zt-table-header-height"),
        ) || 0;
      /** A drag of `el`'s thumb, in the window's own pixels. */
      const geometry = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const bar = el.offsetWidth - el.clientWidth;
        const track = el.clientHeight - trackTop;
        const grab = 8;
        return {
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          track,
          bar,
          x: Math.round((r.right - (bar > 0 ? bar / 2 : 5)) * zoom),
          top: (r.top + trackTop + grab) * zoom,
          span: (track - 2 * grab) * zoom,
        };
      };
      /**
       * Electron's main process sends the pointer along `g.path` and logs
       * each send; with `g.crop`, it reads each screen frame of that part of
       * the window: per band of its height, whether the band holds no ink.
       */
      const driver = async (g: {
        wcId: number;
        x: number;
        top: number;
        span: number;
        path: readonly (readonly [number, number])[];
        innerWidth: number;
        crop: { x: number; y: number; width: number; height: number } | null;
        /** The page's time as it calls, which the driver's times follow. */
        now: number;
      }) => {
        const { webContents } = (
          process as unknown as { mainModule: NodeJS.Module }
        ).mainModule.require("electron") as typeof import("electron");
        const w = webContents.fromId(g.wcId)!;
        // Each process's clock starts at its own origin: the driver's times
        // are the page's.
        const skew = performance.timeOrigin + performance.now() - g.now;
        const clock = () => performance.timeOrigin + performance.now() - skew;
        const nap = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const sends: [number, number, number][] = [];
        const shots: [number, number][] = [];
        const BANDS = 24;
        if (g.crop)
          w.beginFrameSubscription(false, (image) => {
            const t = clock();
            const k = image.getSize().width / g.innerWidth;
            const crop = g.crop!;
            const part = image
              .crop({
                x: Math.round(crop.x * k),
                y: Math.round(crop.y * k),
                width: Math.round(crop.width * k),
                height: Math.round(crop.height * k),
              })
              .resize({ width: 300, quality: "good" });
            const size = part.getSize();
            const bmp = part.toBitmap();
            const W = Math.round(
              Math.sqrt((bmp.length / 4) * (size.width / size.height)),
            );
            const H = Math.floor(bmp.length / 4 / W);
            const lum = (x: number, y: number) => {
              const i = (y * W + x) * 4;
              return (bmp[i]! + bmp[i + 1]! * 2 + bmp[i + 2]!) >> 2;
            };
            const hist = new Uint32Array(256);
            for (let y = 0; y < H; y += 3)
              for (let x = 0; x < W; x += 3) hist[lum(x, y)]!++;
            let bg = 0;
            for (let i = 1; i < 256; i++) if (hist[i]! > hist[bg]!) bg = i;
            let blank = 0;
            for (let b = 0; b < BANDS; b++) {
              let n = 0;
              let ink = 0;
              const ya = Math.floor((H * b) / BANDS);
              const yb = Math.floor((H * (b + 1)) / BANDS);
              for (let y = ya; y < yb; y++)
                for (let x = 0; x < W; x += 2) {
                  n++;
                  if (Math.abs(lum(x, y) - bg) > 4) ink++;
                }
              if (ink / Math.max(1, n) < 0.002) blank++;
            }
            shots.push([t, blank / BANDS]);
          });
        const send = (
          type: "mouseMove" | "mouseDown" | "mouseUp",
          y: number,
        ) => {
          w.sendInputEvent({
            type,
            x: g.x,
            y: Math.round(y),
            button: "left",
            clickCount: 1,
          });
          sends.push([
            clock(),
            Math.round(y),
            type === "mouseMove" ? 0 : type === "mouseDown" ? 1 : 2,
          ]);
        };
        try {
          for (let i = 0; i < 3; i++) {
            send("mouseMove", g.top - 2 + i);
            await nap(40);
          }
          send("mouseDown", g.top);
          await nap(60);
          let at = 0;
          for (const [to, ms] of g.path) {
            const t0 = clock();
            const from = at;
            // Where each leg starts.
            sends.push([t0, Math.round(g.top + g.span * from), 3]);
            await new Promise<void>((resolve) => {
              const step = () => {
                const p = Math.min(1, (clock() - t0) / ms);
                // A hand speeds up and slows down again: the last moves
                // before a hold are short.
                const eased = p * p * (3 - 2 * p);
                if (to !== from)
                  send(
                    "mouseMove",
                    g.top + g.span * (from + (to - from) * eased),
                  );
                if (p < 1) setTimeout(step, 4);
                else resolve();
              };
              step();
            });
            at = to;
          }
          send("mouseUp", g.top + g.span * at);
          await nap(300);
        } finally {
          if (g.crop) w.endFrameSubscription();
        }
        return JSON.stringify({ sends, shots });
      };
      const drive = (
        remote.getGlobal("eval") as (code: string) => typeof driver
      )(`(${driver.toString()})`);
      /** Show an overlay scroll bar, which shows only after a scroll. */
      const showBar = async (el: HTMLElement) => {
        el.scrollTop = 2;
        await sleep(40);
        el.scrollTop = 0;
        await sleep(100);
      };

      // A plain box of the same size and length, with no rows, tells the
      // thumb's length: its drag moves the scroll by the pointer's travel
      // over the track less the thumb.
      // It takes the box's own classes and place among its ancestors, so the
      // same scroll bar styles reach it.
      const plain = box.cloneNode(false) as HTMLElement;
      plain.removeAttribute("data-query-layout");
      const r0 = box.getBoundingClientRect();
      Object.assign(plain.style, {
        position: "fixed",
        left: `${r0.left}px`,
        top: `${r0.top}px`,
        width: `${box.offsetWidth}px`,
        height: `${box.offsetHeight}px`,
        zIndex: "10000",
        background: "var(--background-primary)",
      });
      const fill = doc.createElement("div");
      fill.style.height = `${box.scrollHeight}px`;
      plain.append(fill);
      doc.body.append(plain);
      let thumb = 0;
      try {
        fill.style.height = `${box.scrollHeight - (plain.scrollHeight - box.scrollHeight)}px`;
        await showBar(plain);
        const g = geometry(plain);
        const sent = JSON.parse(
          await drive({
            wcId: contents.id,
            x: g.x,
            top: g.top,
            span: g.span,
            path: [
              [0.5, 300],
              [0.5, 300],
            ],
            innerWidth: win.innerWidth,
            now: performance.timeOrigin + performance.now(),
            crop: null,
          }),
        ) as { sends: [number, number, number][] };
        const down = sent.sends.find((s) => s[2] === 1)!;
        const up = sent.sends.find((s) => s[2] === 2)!;
        const dy = (up[1] - down[1]) / zoom;
        const max = plain.scrollHeight - plain.clientHeight;
        thumb = g.track - (dy * max) / plain.scrollTop;
      } finally {
        plain.remove();
      }

      // The drag of the list itself.
      await showBar(box);
      const g = geometry(box);
      const samples: [number, number, number, number][] = [];
      const header = new Set<string>();
      /** The header's top and each of its cells' left edge and width, from the box's edges. */
      const cells = () => {
        const head = box.querySelector("thead");
        const first = head?.querySelector("th");
        if (!head || !first) return;
        const bounds = box.getBoundingClientRect();
        header.add(
          [
            `top ${Math.round(first.getBoundingClientRect().top - bounds.top)}`,
            ...[...head.querySelectorAll("tr > th")].map((th) => {
              const r = th.getBoundingClientRect();
              return `${Math.round(r.left - bounds.left)}+${Math.round(r.width)}`;
            }),
          ].join(" "),
        );
      };
      let running = true;
      const tick = () => {
        if (!running) return;
        samples.push([
          performance.timeOrigin + performance.now(),
          box.scrollTop,
          box.scrollHeight,
          box.querySelectorAll("[data-index]").length,
        ]);
        cells();
        win.requestAnimationFrame(tick);
      };
      box.addEventListener("scroll", cells);
      win.requestAnimationFrame(tick);
      // The rows' part of the box: under a Table's header, beside the bar.
      const crop = {
        x: g.rect.left,
        y: g.rect.top + trackTop,
        width: Math.max(1, g.rect.right - g.rect.left - Math.max(g.bar, 16)),
        height: Math.max(1, g.rect.bottom - g.rect.top - trackTop),
      };
      let run: {
        sends: [number, number, number][];
        shots: [number, number][];
      };
      try {
        run = JSON.parse(
          await drive({
            wcId: contents.id,
            x: g.x,
            top: g.top,
            span: g.span,
            path,
            innerWidth: win.innerWidth,
            now: performance.timeOrigin + performance.now(),
            crop,
          }),
        );
      } finally {
        running = false;
        box.removeEventListener("scroll", cells);
      }
      const { shots } = run;
      const starts = run.sends.filter((s) => s[2] === 3).map((s) => s[0]);
      const sends = run.sends.filter((s) => s[2] !== 3);
      const down = sends.find((s) => s[2] === 1)!;
      const up = sends.find((s) => s[2] === 2)!;
      const moves = sends.filter((s) => s[2] === 0).map((s) => s[0]);
      /** Whether the pointer moved in the 50 ms before `t`. */
      const moving = (t: number) => moves.some((m) => m <= t && t - m < 50);
      const pointerAt = (t: number) => {
        let y = sends[0]![1];
        for (const s of sends) {
          if (s[0] > t) break;
          y = s[1];
        }
        return y / zoom;
      };
      /** The thumb's top against the pointer's travel since the press, in pt. */
      const offset = ([t, top, length]: readonly number[]) => {
        const max = length! - box.clientHeight;
        return (
          (top! / max) * (g.track - thumb) - (pointerAt(t!) - down[1] / zoom)
        );
      };
      const during = samples.filter(([t]) => t >= down[0] && t <= up[0]);
      const lengthChanges = { moving: 0, resting: 0 };
      for (let i = 1; i < during.length; i++)
        if (during[i]![2] !== during[i - 1]![2])
          lengthChanges[moving(during[i]![0]) ? "moving" : "resting"]++;
      // Each leg's frames, and the end of each hold.
      const holds: number[] = [];
      /** A screen frame that shows nothing in the box: neither rows nor outlines. */
      const EMPTY = 0.9;
      const legs: DragRecord["legs"][number][] = [];
      let at = 0;
      for (const [leg, [to]] of path.entries()) {
        const start = starts[leg]!;
        const end = starts[leg + 1] ?? up[0];
        const frames = during.filter(([t]) => t >= start && t < end);
        const mounted = frames.map((s) => s[3]);
        const screens = shots.filter(([t]) => t >= start && t < end);
        legs.push({
          to,
          fewest: Math.min(...mounted),
          most: Math.max(...mounted),
          frames: screens.length,
          empty: screens.filter(([, blank]) => blank >= EMPTY).length,
        });
        if (to === at) {
          const last = during.filter(([t]) => t <= end - 20).at(-1);
          if (last) holds.push(Math.round(offset(last) * 10) / 10);
        }
        at = to;
      }
      const movingOffsets = during
        .filter(([t]) => moving(t))
        .map((s) => Math.abs(offset(s)));
      const shown = shots.filter(([t]) => t >= starts[0]! && t <= up[0]);
      // The rows at the list's top, at rest: a group's heading among them.
      box.scrollTop = 0;
      await sleep(400);
      const row = Number.parseFloat(
        getComputedStyle(box).getPropertyValue("--zt-virtual-row"),
      );
      const heights = [
        ...box.querySelectorAll<HTMLElement>("[data-index]"),
      ].map((el) => el.getBoundingClientRect().height);
      return JSON.stringify({
        box: { length: box.scrollHeight, height: box.clientHeight },
        thumb: Math.round(thumb * 10) / 10,
        holds,
        moving: Math.round(Math.max(0, ...movingOffsets) * 10) / 10,
        lengthChanges,
        legs,
        screen: {
          frames: shown.length,
          empty: shown.filter(([, blank]) => blank >= EMPTY).length,
          blankShare:
            Math.round(Math.max(0, ...shown.map(([, blank]) => blank)) * 100) /
            100,
        },
        header: [...header],
        rows: {
          mounted: heights.length,
          unlike: heights.filter((h) => Math.abs(h - row) >= 1).length,
        },
      } satisfies DragRecord);
    },
    { host, boxes: BOXES, path },
    { timeoutMs: 60_000 },
  );
  return JSON.parse(json) as DragRecord;
}
