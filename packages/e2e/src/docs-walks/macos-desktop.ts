// Real desktop input and screen recording on macOS, for the docs-walk shots
// a page script cannot reach: a menu in the macOS menu bar and the macOS file
// dialog. Each click first checks that the app it is meant for is in front,
// so input never lands in another app. These shots need the desktop to
// themselves: run them only in an unattended window, with the other apps
// hidden (see packages/e2e/AGENTS.md, "Docs walks").

import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CameraEvent, CameraTrack, Rect } from "./camera.ts";
import type { ClipSettings } from "./clip-settings.ts";

const execFileAsync = promisify(execFile);

/** No call to macOS waits longer than this. */
const OSASCRIPT = { timeout: 20000 };
const jxa = async (script: string): Promise<string> =>
  (
    await execFileAsync(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      OSASCRIPT,
    )
  ).stdout.trim();
const applescript = async (...lines: string[]): Promise<string> =>
  (
    await execFileAsync(
      "osascript",
      lines.flatMap((l) => ["-e", l]),
      OSASCRIPT,
    )
  ).stdout.trim();

/**
 * Another app came to the front while a desktop shot recorded: its frames
 * may show that app, so they are deleted, and the walk takes the shot again.
 */
export class DesktopShotSpoiled extends Error {}

/** The process id of the app in front. */
export async function frontmostPid(): Promise<number> {
  return Number(
    await applescript(
      'tell application "System Events" to get unix id of first process whose frontmost is true',
    ),
  );
}

/** Bring the app of process `pid` to the front, and check it is there. */
export async function bringToFront(pid: number): Promise<void> {
  await jxa(
    `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(1); ""`,
  );
  for (let i = 0; i < 20; i++) {
    if ((await frontmostPid()) === pid) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`process ${pid} did not come to the front`);
}

/**
 * Bring `pid` back to the front when another app took it, and check it is
 * there before any input is sent.
 */
async function requireFront(pid: number): Promise<void> {
  if ((await frontmostPid()) !== pid) await bringToFront(pid);
  const front = await frontmostPid();
  if (front !== pid)
    throw new Error(
      `process ${front} is in front, not ${pid}: no input is sent`,
    );
}

/**
 * Hide or show the app named `name`, as Command-H does: its windows leave
 * the screen and come back as they were.
 */
export async function setAppVisible(
  name: string,
  visible: boolean,
): Promise<void> {
  await applescript(
    `tell application "System Events" to set visible of application process ${JSON.stringify(name)} to ${visible}`,
  );
}

/** The centre of a menu bar item of `pid`, or of an item in its open menu, in screen points. */
export async function menuPoint(
  pid: number,
  menu: string,
  item?: string,
): Promise<{ x: number; y: number }> {
  const target = item
    ? `menu item "${item}" of menu 1 of menu bar item "${menu}" of menu bar 1`
    : `menu bar item "${menu}" of menu bar 1`;
  const reply = await applescript(
    `tell application "System Events" to tell (first process whose unix id is ${pid}) to get {position, size} of ${target}`,
  );
  const [x, y, w, h] = reply.split(",").map((n) => Number(n.trim()));
  return { x: x! + w! / 2, y: y! + h! / 2 };
}

/** One on-screen window, front to back: its id, layer, owner and bounds in points. */
export interface ScreenWindow {
  id: number;
  layer: number;
  pid: number;
  owner: string;
  name: string;
  bounds: Rect;
}

/** The on-screen windows of the layers apps draw in, front to back. */
export async function screenWindows(): Promise<ScreenWindow[]> {
  const out = await jxa(
    `ObjC.import("CoreGraphics"); const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)); const out = []; for (let i = 0; i < Number(a.count); i++) { const w = ObjC.deepUnwrap(a.objectAtIndex(i)); if (w.kCGWindowLayer >= 0 && w.kCGWindowLayer < 24) out.push({ id: w.kCGWindowNumber, layer: w.kCGWindowLayer, pid: w.kCGWindowOwnerPID, owner: w.kCGWindowOwnerName, name: w.kCGWindowName || "", bounds: { x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height } }); } JSON.stringify(out)`,
  );
  return JSON.parse(out) as ScreenWindow[];
}

const meets = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Throw unless no other app's window over `region` sits in front of any of
 * `pid`'s windows, apart from the Dock's full-screen layer: such a window
 * would be recorded.
 */
export async function assertRegionClear(
  pid: number,
  region: Rect,
): Promise<void> {
  const windows = await screenWindows();
  const own = windows.findLastIndex((w) => w.pid === pid && w.layer === 0);
  const over = windows
    .slice(0, own === -1 ? windows.length : own)
    .filter(
      (w) =>
        w.pid !== pid &&
        w.layer !== 20 &&
        w.bounds.w > 0 &&
        meets(w.bounds, region),
    );
  if (over.length > 0)
    throw new Error(
      `windows of other apps cover the recorded region: ${over.map((w) => `${w.owner} "${w.name}"`).join(", ")}`,
    );
}

/** What a desktop shot's actions can do while it records. */
export interface DesktopShot {
  /** Glide the real pointer to `x`, `y` and click there, once `pid` is checked in front. */
  click(x: number, y: number): Promise<void>;
  /** Glide the real pointer to `x`, `y` without a click. */
  move(x: number, y: number): Promise<void>;
  /** Frame `view` from now on: an eased move, or a cut. */
  frame(view: Rect, options?: { cut?: boolean }): void;
  /** Wait `ms`. */
  wait(ms: number): Promise<void>;
  /**
   * End the shot now: the frames after it stay out of the clip, and it has
   * no rest, for a shot whose next frames must not show.
   */
  end(): void;
}

/**
 * Record the screen region `region` (points) into `dir` as a shot, while
 * `actions` click and type into the app of `pid` with the real pointer. The
 * shot's track is the views `actions` frame, from `start`; it lands in
 * `dir/track.json`, with the frames, `frames.json` and `camera.json`, as
 * `encodeClip` reads them. macOS draws its own pointer into the recording.
 */
export async function recordDesktop<T>(
  dir: string,
  options: {
    pid: number;
    region: Rect;
    start: Rect;
    settings: ClipSettings;
    /** Parts of the screen (points) to blur in every frame of the shot. */
    blur?: Rect[];
  },
  actions: (shot: DesktopShot) => Promise<T>,
): Promise<T> {
  const { pid, region, settings: s } = options;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await requireFront(pid);
  await assertRegionClear(pid, region);
  // ffmpeg records the main screen with the pointer, and stamps each frame
  // with the wall clock, so the frames and the actions share one clock.
  const scale = Number(
    await jxa(
      `ObjC.import("AppKit"); String($.NSScreen.mainScreen.backingScaleFactor)`,
    ),
  );
  const movie = join(dir, "screen.mkv");
  const capture = spawn(
    "ffmpeg",
    [
      ...["-hide_banner", "-v", "error", "-y"],
      ...["-f", "avfoundation", "-pixel_format", "bgr0"],
      ...["-capture_cursor", "1", "-framerate", "30"],
      ...["-use_wallclock_as_timestamps", "1", "-i", "Capture screen 0:none"],
      "-vf",
      `crop=${region.w * scale}:${region.h * scale}:${region.x * scale}:${region.y * scale},settb=1/1000`,
      ...["-copyts", "-enc_time_base", "1/1000", "-fps_mode", "passthrough"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "8"],
      movie,
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  const ended = new Promise((r) => capture.once("exit", r));
  const now = () => Temporal.Now.instant().epochMilliseconds / 1000;
  const events: (CameraEvent & { t: number })[] = [];
  const views: { t: number; view: Rect; cut: boolean }[] = [];
  let endAt: number | undefined;
  const blurs: { rect: Rect; from?: number; to?: number }[] = (
    options.blur ?? []
  ).map((rect) => ({ rect }));
  const glideMs = s.glide * 1000;
  const glide = (x: number, y: number) =>
    jxa(
      `ObjC.import("CoreGraphics"); ObjC.import("AppKit"); const loc = $.NSEvent.mouseLocation; const H = $.NSScreen.mainScreen.frame.size.height; const fx = loc.x, fy = H - loc.y; const n = ${Math.max(1, Math.round(glideMs / 16))}; for (let i = 1; i <= n; i++) { const p = i / n; const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, $.CGPointMake(fx + (${x} - fx) * e, fy + (${y} - fy) * e), $.kCGMouseButtonLeft)); delay(${glideMs / 1000} / n); } ""`,
    );
  const shot: DesktopShot = {
    async click(x, y) {
      await requireFront(pid);
      await glide(x, y);
      await requireFront(pid);
      events.push({
        kind: "point",
        t: now(),
        x: x - region.x,
        y: y - region.y,
      });
      await jxa(
        `ObjC.import("CoreGraphics"); const p = $.CGPointMake(${x}, ${y}); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, p, $.kCGMouseButtonLeft)); delay(0.05); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, p, $.kCGMouseButtonLeft)); ""`,
      );
    },
    async move(x, y) {
      await glide(x, y);
      events.push({ kind: "park", t: now(), x: x - region.x, y: y - region.y });
    },
    frame(view, { cut = false } = {}) {
      views.push({ t: now(), view, cut });
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    end() {
      endAt ??= now();
    },
  };
  // Whoever takes the front during the shot spoils it.
  let spoiled: number | undefined;
  let watching = true;
  const watch = (async () => {
    while (watching) {
      const front = await frontmostPid().catch(() => pid);
      if (front !== pid) spoiled ??= front;
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  let result: { value: T } | undefined;
  let failure: unknown;
  try {
    // ffmpeg takes a moment to start.
    await new Promise((r) => setTimeout(r, 1000));
    await new Promise((r) => setTimeout(r, s.opening * 1000));
    result = { value: await actions(shot) };
    if (endAt === undefined)
      await new Promise((r) => setTimeout(r, s.rest * 1000));
  } catch (error) {
    failure = error;
  } finally {
    watching = false;
    await watch;
    capture.stdin.end("q");
    const timer = setTimeout(() => capture.kill("SIGKILL"), 15000);
    await ended;
    clearTimeout(timer);
    // The first frame's wall-clock stamp is the shot's start. ffprobe fails
    // on a movie that ffmpeg could not record.
    const stamps = (
      await execFileAsync("ffprobe", [
        ...["-v", "error", "-select_streams", "v"],
        ...["-show_entries", "frame=pts_time", "-of", "csv=p=0"],
        movie,
      ])
    ).stdout
      .split("\n")
      .map((l) => Number.parseFloat(l))
      .filter((t) => Number.isFinite(t));
    const t0 = stamps[0]!;
    const recorded = stamps.at(-1)! - t0;
    const length =
      endAt === undefined ? recorded : Math.min(recorded, endAt - t0);
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      movie,
      "-vf",
      `fps=${s.fps}`,
      join(dir, "f%05d.png"),
    ]);
    // The frames ffmpeg wrote, up to the shot's end.
    const frames = (await readdir(dir))
      .filter((f) => /^f\d{5}\.png$/.test(f))
      .toSorted()
      .map((file, i) => ({ file, t: i / s.fps }))
      .filter((f) => f.t < length);
    await writeFile(
      join(dir, "frames.json"),
      JSON.stringify([...frames, { file: "", t: length }], null, 2),
    );
    const W = region.w;
    const H = region.h;
    await writeFile(
      join(dir, "camera.json"),
      JSON.stringify(
        {
          viewport: { width: W, height: H },
          events: events.map((e) => ({ ...e, t: e.t - t0 })),
          settings: s,
          blur: blurs.map(({ rect, from, to }) => ({
            x: rect.x - region.x,
            y: rect.y - region.y,
            w: rect.w,
            h: rect.h,
            ...(from !== undefined && { from: from - t0 }),
            ...(to !== undefined && { to: to - t0 }),
          })),
        },
        null,
        2,
      ),
    );
    // The views, in the region's points, from the start view on.
    const local = (v: Rect) => ({ ...v, x: v.x - region.x, y: v.y - region.y });
    const keyframes: CameraTrack["keyframes"] = [
      { t: 0, view: local(options.start) },
    ];
    let current = local(options.start);
    for (const v of views) {
      // A move starts once the one before it has ended.
      const t = Math.max(keyframes.at(-1)!.t, v.t - t0);
      const next = local(v.view);
      keyframes.push({ t, view: current });
      keyframes.push({ t: v.cut ? t : t + s.ease, view: next });
      current = next;
    }
    keyframes.push({ t: length, view: current });
    await writeFile(
      join(dir, "track.json"),
      `${JSON.stringify({ keyframes }, null, 2)}\n`,
    );
  }
  if (spoiled !== undefined) {
    await rm(dir, { recursive: true, force: true });
    throw new DesktopShotSpoiled(
      `process ${spoiled} came to the front during the shot; its frames are deleted`,
      { cause: failure },
    );
  }
  if (!result) throw failure;
  return result.value;
}

/** Send `keys` to the app of `pid` through System Events, once it is checked in front. */
export async function typeKeys(
  pid: number,
  steps: (
    | { text: string }
    | { keyCode: number }
    | { key: string; modifiers: ("command" | "shift" | "option")[] }
    | { delay: number }
  )[],
): Promise<void> {
  await requireFront(pid);
  const lines = steps.map((step) =>
    "text" in step
      ? `keystroke ${JSON.stringify(step.text)}`
      : "keyCode" in step
        ? `key code ${step.keyCode}`
        : "key" in step
          ? `keystroke ${JSON.stringify(step.key)} using {${step.modifiers.map((m) => `${m} down`).join(", ")}}`
          : `delay ${step.delay}`,
  );
  await applescript('tell application "System Events"', ...lines, "end tell");
}
