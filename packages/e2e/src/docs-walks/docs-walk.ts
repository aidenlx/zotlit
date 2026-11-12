// The shared harness of the docs walks: each walk is one docs lesson, run as
// its reader would through the real apps. See packages/e2e/AGENTS.md, "Docs
// walks".

import { prepareRunWindow } from "@e2e/background-throttling.ts";
import type { CameraEvent, Rect } from "@e2e/docs-walks/camera.ts";
import {
  encodeClip,
  encodeMovie,
  readTrack,
} from "@e2e/docs-walks/clip-encode.ts";
import type { CameraLog, RecordedFrame } from "@e2e/docs-walks/clip-encode.ts";
import { clipSettings } from "@e2e/docs-walks/clip-settings.ts";
import type { ClipSettings } from "@e2e/docs-walks/clip-settings.ts";
import {
  outputSizes,
  takeRecipe,
  takeRun,
  videoLength,
  writeTake,
} from "@e2e/docs-walks/takes.ts";
import type { TakeRun } from "@e2e/docs-walks/takes.ts";
import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";
import { openPairedEnvironment } from "@e2e/paired-environment.ts";
import { openZoteroRdp } from "@e2e/paired-zotero.ts";
import type { ZoteroRdp } from "@e2e/paired-zotero.ts";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const execFileAsync = promisify(execFile);

declare module "../page-helpers.ts" {
  interface PageScratch {
    /** Each notice text shown since {@link watchNotices} last reset it. */
    docsWalkNotices?: string[];
    docsWalkNoticeObserver?: MutationObserver;
    /**
     * The drawn pointer of a recording, present only while
     * {@link DocsWalk.record} records. A walk's step points at an element
     * with it before a click, and types through it at a person's pace.
     */
    docsWalkPointer?: DocsWalkPointer;
    /** Ends the screencast that {@link DocsWalk.record} started. */
    /** Hides the notices a recording held on screen, and stops holding. */
    docsWalkReleaseNotices?: () => void;
    docsWalkStopRecording?: () => Promise<{
      frames: RecordedFrame[];
      camera: CameraLog;
    }>;
  }
}

/** The pointer a recording draws, since the walk's clicks move no mouse. */
export interface DocsWalkPointer {
  /**
   * Glide to `el` and show a click mark there: at its centre, or `inset` px
   * from its left edge for a wide element whose text the pointer would hide.
   */
  point(el: Element, options?: { inset?: number }): Promise<void>;
  /** Glide to the point `x`, `y` in CSS px and show a click mark there. */
  pointAt(x: number, y: number): Promise<void>;
  /**
   * Glide to the point `x`, `y` without a click, to clear what it hides. The
   * camera does not follow it.
   */
  park(x: number, y: number): Promise<void>;
  /** Type `text` into `input` one key at a time, as a person types. */
  type(input: HTMLInputElement, text: string): Promise<void>;
  /**
   * Hand `text` to `put` one key at a time, at a person's typing pace, or
   * `speed` times that pace for a long sentence that must fit a short clip.
   */
  keys(
    text: string,
    put: (key: string) => void,
    options?: { speed?: number },
  ): Promise<void>;
  /**
   * Frame `target` with the camera, without a pointer move: an element, a
   * box in CSS px, or several, framed together with `padding` px about them.
   * A step ends on a look at what its check names.
   */
  look(
    target: LookTarget | readonly LookTarget[],
    options?: { padding?: number },
  ): Promise<void>;
}

/** What {@link DocsWalkPointer.look} frames: an element or a box in CSS px. */
export type LookTarget =
  | Element
  | { left: number; top: number; right: number; bottom: number };

/**
 * Record the text of every notice the window shows from now on, for
 * {@link readNotices} and for page callbacks that read
 * `page.scratch.docsWalkNotices`. A second call empties the record.
 */
export async function watchNotices(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    const { scratch } = page;
    scratch.docsWalkNotices = [];
    if (scratch.docsWalkNoticeObserver) return;
    scratch.docsWalkNoticeObserver = new MutationObserver(() => {
      const seen = (scratch.docsWalkNotices ??= []);
      for (const n of document.querySelectorAll(".notice")) {
        const t = n.textContent;
        if (!seen.includes(t)) seen.push(t);
      }
    });
    scratch.docsWalkNoticeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

/** Every notice text {@link watchNotices} recorded, in the order shown. */
export function readNotices(vaultId: string): Promise<string[]> {
  return obRun(vaultId, ({ page }) => page.scratch.docsWalkNotices ?? []);
}

/**
 * Close the Zotero library tab's setup section, as the reader did with its ×
 * in Lesson 1: the walk writes the setting that × writes.
 */
export async function closeWelcome(vaultId: string): Promise<void> {
  await obRun(vaultId, async ({ zotlit }) => {
    const s = zotlit.services;
    s.bridge.runSync(
      s.settings.update({
        "welcome.dismissed": true,
        "welcome.requested": false,
        "welcome.steps-shown": false,
      }),
    );
    await s.bridge.runPromise(s.settings.flush);
  });
}

/** `DOCS_WALK_CAPTURE=1` turns a walk's planned shots into docs images. */
export function captureRequested(): boolean {
  return process.env.DOCS_WALK_CAPTURE === "1";
}

/**
 * `DOCS_WALK_RECORD=1` turns a walk's planned clips into docs videos; with
 * `name`, `DOCS_WALK_ONLY` (clip names, comma-separated) narrows them to the
 * clips it names, while the walk still runs every step.
 */
export function recordRequested(name?: string): boolean {
  if (process.env.DOCS_WALK_RECORD !== "1") return false;
  const only = process.env.DOCS_WALK_ONLY;
  return !name || !only || only.split(",").includes(name);
}

export interface DocsWalkOptions {
  /** The docs page's slug; names the layout folder and the capture folder. */
  slug: string;
  /** The folder under `apps/docs/public/img/` that receives the images. */
  collection: string;
  /** @default "demo" */
  vaultCase?: string;
  /**
   * The window size every capture is taken at, in points. A screen shorter
   * than `height` caps it, so keep it within a laptop screen.
   * @default { width: 1440, height: 860 }
   */
  window?: { width: number; height: number };
  /**
   * The walk's own clip settings, over the defaults and under the run's
   * `DOCS_WALK_CLIP` overrides (`clip-settings.ts`).
   */
  clip?: Partial<ClipSettings>;
}

/** One open walk: a Paired Run on its Vault Case and its capture tools. */
export interface DocsWalk extends AsyncDisposable {
  vaultId: string;
  /** Paired Zotero's parent process, for the reader's steps in Zotero. */
  zotero: ZoteroRdp;
  /**
   * Save the Obsidian window as the layer `layer`, without the notices on
   * screen unless `notices` keeps them, for a step whose check is a notice.
   * Does nothing unless the run captures.
   */
  capture(layer: string, options?: { notices?: boolean }): Promise<void>;
  /**
   * Compose the image `name` into the docs. The layout
   * `<slug>.layouts/<name>.json` beside the walk places the layers by name
   * (`"src": "<layer>.png"`); without one, the layer `name` becomes one
   * window without traffic lights, centred with a margin. Does nothing unless
   * the run captures.
   */
  compose(name: string): Promise<void>;
  /**
   * Run `actions`, the reader's actions of one step, and record them as the
   * clip `name`: `<name>.webm` and `<name>.mp4` beside the step's image. The
   * window shows a drawn pointer while it records, and the clip rests on the
   * result. A camera planned from the pointer's actions, or the track
   * `<slug>.camera/<name>.json` beside the walk, frames each part of the
   * clip; its last frame is `<name>.poster.webp`, and its take goes into
   * `<slug>.takes.json`. Without `DOCS_WALK_RECORD=1`, or with a
   * `DOCS_WALK_ONLY` that leaves it out, it only runs `actions`.
   * With `notices`, for a step whose check is a notice, the layer `name` is
   * captured with its notices as soon as `actions` end, while the notice
   * still shows; the step's later `capture(name)` then keeps that layer.
   */
  record<T>(
    name: string,
    actions: () => Promise<T>,
    options?: { notices?: boolean },
  ): Promise<T>;
  /**
   * Run `actions` in Zotero and record the Paired Zotero window whose title
   * matches `title` with macOS window capture, as {@link record} does for
   * Obsidian. Zotero comes to the front for the clip. `pointAt` draws a
   * pointer in that window before a click. `stop` rests and ends the clip
   * early, before an action that closes the window. Without
   * `DOCS_WALK_RECORD=1`, it only runs `actions`.
   */
  recordZotero<T>(
    name: string,
    title: RegExp,
    actions: (
      pointAt: (window: string, element: string) => Promise<void>,
      stop: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
}

interface Layout {
  margin?: number;
  layers: { src: string; lights?: boolean }[];
}

/**
 * Open a walk: a new Fixture on its Vault Case, a new vault on it, and a
 * Paired Zotero with its Local API open, all disposed with the walk.
 */
export async function openDocsWalk(
  options: DocsWalkOptions,
): Promise<DocsWalk> {
  const root = await getWorkspaceRoot(import.meta.dirname);
  const { width, height } = options.window ?? { width: 1440, height: 860 };
  await using stack = new AsyncDisposableStack();
  const environment = stack.use(
    await openPairedEnvironment(root, {
      name: "docs-walk",
      vaultCase: options.vaultCase ?? "demo",
    }),
  );
  const { vaultId } = environment;
  await prepareRunWindow(vaultId);
  await obRun(vaultId, ({ app }) => {
    app.vault.setConfig("nativeMenus", false);
  });
  await obRun(
    vaultId,
    (_, size) => {
      (
        require("@electron/remote") as {
          getCurrentWindow(): { setSize(width: number, height: number): void };
        }
      )
        .getCurrentWindow()
        .setSize(size.width, size.height);
    },
    { width, height },
  );
  const zotero = stack.use(await openZoteroRdp(environment.debuggerPort));

  const captures = join(root, ".scratch", "docs-walks", options.slug);
  const layouts = join(import.meta.dirname, `${options.slug}.layouts`);
  const tracks = join(import.meta.dirname, `${options.slug}.camera`);
  const settings = clipSettings(options.clip);
  const takes = join(import.meta.dirname, `${options.slug}.takes.json`);
  let run: TakeRun | undefined;
  /** The facts every take of this walk repeats, read once. */
  const runFacts = async () =>
    (run ??= await takeRun(root, {
      slug: options.slug,
      running: (await cli(["version"])).trim(),
      zotero: await zotero.json<string>("Zotero.version"),
      vaultCase: options.vaultCase ?? "demo",
      window: { width, height },
    }));
  const images = join(
    root,
    "apps",
    "docs",
    "public",
    "img",
    options.collection,
  );

  /** Layers a recording already captured while its notice showed. */
  const taken = new Set<string>();
  const shoot = async (layer: string, notices: boolean) => {
    await mkdir(captures, { recursive: true });
    // A notice is transient: the walk asserts it, and the image leaves it
    // out unless the notice is what the step shows.
    if (!notices) await clearNotices(vaultId);
    else
      // A new notice slides in from the window's right edge.
      await obRun(vaultId, async ({ page }) => {
        // The image is taken either way; a notice still moving shows cut.
        await page
          .until(
            "notices in place",
            () =>
              [...document.querySelectorAll(".notice")].every(
                (n) => n.getBoundingClientRect().right <= window.innerWidth,
              ),
            2000,
          )
          .catch(() => undefined);
      });
    // A capture taken in the frame after a change can show the old DOM.
    await obRun(
      vaultId,
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await cli([
      `vault=${vaultId}`,
      "dev:screenshot",
      `path=${join(captures, `${layer}.png`)}`,
    ]);
  };

  const owned = stack.move();
  return {
    vaultId,
    zotero,
    async capture(layer, { notices = false } = {}) {
      if (!captureRequested()) return;
      if (taken.delete(layer)) return;
      await shoot(layer, notices);
    },
    async compose(name) {
      if (!captureRequested()) return;
      const layoutFile = join(layouts, `${name}.json`);
      const layout: Layout = await access(layoutFile).then(
        async () => JSON.parse(await readFile(layoutFile, "utf8")) as Layout,
        () => ({
          margin: 0.1,
          layers: [{ src: `${name}.png`, lights: false }],
        }),
      );
      // compose.mjs resolves each layer from the layout file, so the resolved
      // copy sits beside the captures.
      const resolved = join(captures, `${name}.layout.json`);
      await writeFile(resolved, JSON.stringify(layout, null, 2));
      await mkdir(images, { recursive: true });
      await execFileAsync(
        process.execPath,
        [
          join(root, ".agents", "skills", "docs-screenshot", "compose.mjs"),
          join(images, `${name}.webp`),
          resolved,
        ],
        { windowsHide: true },
      );
    },
    async record(name, actions, { notices = false } = {}) {
      if (!recordRequested(name)) return actions();
      const frames = join(captures, `${name}.frames`);
      await rm(frames, { recursive: true, force: true });
      await startRecording(vaultId, frames, settings);
      if (notices)
        // The notice the step checks stays on screen to the clip's end, so
        // the clip rests on it.
        await obRun(vaultId, ({ page }) => {
          // A notice that leaves the page is put back where it was.
          const held = new Set<Element>();
          const observer = new MutationObserver((records) => {
            for (const record of records)
              for (const node of record.removedNodes) {
                if (
                  !(node instanceof Element) ||
                  !(node.matches(".notice") || node.querySelector(".notice"))
                )
                  continue;
                // Undo the fade and the slide up that hide it.
                for (const n of [node, ...node.querySelectorAll(".notice")])
                  if (n instanceof HTMLElement) {
                    n.style.transition = "none";
                    n.style.opacity = "1";
                    n.style.marginTop = "";
                  }
                // A container that leaves next holds the notice again, and is
                // put back in turn.
                record.target.appendChild(node);
                held.add(node);
              }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          page.scratch.docsWalkReleaseNotices = () => {
            observer.disconnect();
            for (const node of held) node.remove();
          };
        });
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions();
        if (notices && captureRequested()) {
          // The notice lasts a few seconds, less than the clip's rest and
          // its end; the image leaves the drawn pointer out.
          await obRun(vaultId, () => {
            for (const el of document.querySelectorAll<HTMLElement>(
              "[data-docs-walk-pointer]",
            ))
              el.style.visibility = "hidden";
          });
          await shoot(name, true);
          taken.add(name);
          await obRun(vaultId, () => {
            for (const el of document.querySelectorAll<HTMLElement>(
              "[data-docs-walk-pointer]",
            ))
              el.style.visibility = "";
          });
        }
        await new Promise((r) => setTimeout(r, settings.rest * 1000));
      } finally {
        const recorded = await obRun(vaultId, async ({ page }) => {
          const stop = page.scratch.docsWalkStopRecording;
          delete page.scratch.docsWalkStopRecording;
          delete page.scratch.docsWalkPointer;
          for (const el of document.querySelectorAll(
            "[data-docs-walk-pointer]",
          ))
            el.remove();
          const done = stop ? await stop() : undefined;
          page.scratch.docsWalkReleaseNotices?.();
          delete page.scratch.docsWalkReleaseNotices;
          return done;
        });
        await writeFile(
          join(frames, "frames.json"),
          JSON.stringify(recorded?.frames ?? [], null, 2),
        );
        if (recorded)
          await writeFile(
            join(frames, "camera.json"),
            JSON.stringify({ ...recorded.camera, settings }, null, 2),
          );
      }
      await mkdir(images, { recursive: true });
      const out = join(images, name);
      const override = settings.camera
        ? await readTrack(join(tracks, `${name}.json`))
        : undefined;
      const cut = await encodeClip(frames, out, { track: override, settings });
      await writeTake(takes, name, {
        recordedAt: Temporal.Now.instant().toString(),
        step: expect.getState().currentTestName ?? "",
        recipe: takeRecipe(root, { slug: options.slug, name, out, frames }),
        ...(await runFacts()),
        source: "obsidian-screencast",
        frames: relative(root, frames),
        settings,
        duration: await videoLength(`${out}.mp4`),
        outputs: await outputSizes(root, out),
        camera: {
          track: !settings.camera ? "whole" : override ? "override" : "planned",
          viewport: cut.log.viewport,
          events: cut.log.events,
          keyframes: cut.track.keyframes,
        },
      });
      return result;
    },
    async recordZotero(name, title, actions) {
      const pointAt = (window: string, element: string) =>
        zoteroPointer(zotero, window, element);
      if (!recordRequested(name))
        return actions(
          async () => {},
          async () => {},
        );
      await mkdir(captures, { recursive: true });
      const pid = await zotero.json<number>("Services.appinfo.processID");
      const movie = join(captures, `${name}.mov`);
      await rm(movie, { force: true });
      // Zotero comes to the front and raises the window itself.
      await activate(pid);
      await zotero.json<boolean>(
        `(()=>{const t=new RegExp(${JSON.stringify(title.source)});for(const w of Services.wm.getEnumerator(null))if(t.test(w.document.title)){w.focus();return true;}return false;})()`,
      );
      await new Promise((r) => setTimeout(r, 800));
      const target = await zoteroWindow(pid, title);
      // A capture of a dialog window records black, so a dialog records as
      // its screen area, with its rounded corners cut away.
      const dialog = target.layer > 0;
      const capture = spawn(
        "screencapture",
        dialog
          ? ["-x", "-v", "-R", target.bounds, movie]
          : ["-x", "-v", "-o", "-l", String(target.id), movie],
        { stdio: "ignore" },
      );
      const ended = new Promise((r) => capture.once("exit", r));
      await new Promise((r) => setTimeout(r, 800));
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        await new Promise((r) => setTimeout(r, settings.rest * 1000));
        capture.kill("SIGINT");
        await ended;
      };
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions(pointAt, stop);
      } finally {
        await stop();
        await zotero
          .json<boolean>(
            `(()=>{for(const w of Services.wm.getEnumerator(null))for(const e of [...w.document.querySelectorAll('[data-docs-walk-pointer]')])e.remove();return true;})()`,
          )
          .catch(() => false);
      }
      await mkdir(images, { recursive: true });
      const out = join(images, name);
      await encodeMovie(movie, out, { inset: dialog ? 24 : 0, settings });
      await writeTake(takes, name, {
        recordedAt: Temporal.Now.instant().toString(),
        step: expect.getState().currentTestName ?? "",
        recipe: takeRecipe(root, { slug: options.slug, name, out }),
        ...(await runFacts()),
        source: "zotero-window",
        frames: relative(root, movie),
        settings,
        duration: await videoLength(`${out}.mp4`),
        outputs: await outputSizes(root, out),
      });
      return result;
    },
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

/**
 * Start a CDP screencast of the vault's window into `dir`, one PNG per
 * frame with its timestamp, and draw the pointer the walk's steps use. Each
 * pointer action is logged for the camera, on the frames' clock.
 */
async function startRecording(
  vaultId: string,
  dir: string,
  settings: ClipSettings,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ page }, { dir, opening, glideMs, typing, lookMs }) => {
      const fs = require("fs") as typeof import("node:fs");
      const path = require("path") as typeof import("node:path");
      fs.mkdirSync(dir, { recursive: true });
      const contents = (
        require("@electron/remote") as typeof import("@electron/remote")
      ).getCurrentWebContents();
      const cdp = contents.debugger;
      if (!cdp.isAttached()) cdp.attach("1.3");
      const frames: { file: string; t: number }[] = [];
      const onMessage = (
        _event: unknown,
        method: string,
        params: {
          data: string;
          sessionId: number;
          metadata: { timestamp: number };
        },
      ) => {
        if (method !== "Page.screencastFrame") return;
        const file = `f${String(frames.length).padStart(5, "0")}.png`;
        fs.writeFileSync(
          path.join(dir, file),
          Buffer.from(params.data, "base64"),
        );
        frames.push({ file, t: params.metadata.timestamp });
        cdp
          .sendCommand("Page.screencastFrameAck", {
            sessionId: params.sessionId,
          })
          .catch(() => {});
      };
      cdp.on("message", onMessage);

      // The pointer: an arrow that glides to its target, and a ring that
      // marks the click.
      const pointer = document.body.createDiv({
        attr: { "data-docs-walk-pointer": "" },
      });
      pointer.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform ${Math.max(0, glideMs - 50)}ms cubic-bezier(.4,0,.2,1);`;
      pointer.innerHTML =
        '<svg width="22" height="26" viewBox="0 0 22 26" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M2 1.5v20.2l5.3-5.1 3.4 7.8 3.4-1.5-3.3-7.6 7.4-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const ring = document.body.createDiv({
        attr: { "data-docs-walk-pointer": "" },
      });
      ring.style.cssText =
        "position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid hsl(var(--interactive-accent-hsl));background:hsla(var(--interactive-accent-hsl),.18);z-index:2147483646;pointer-events:none;opacity:0;";
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const start = {
        x: Math.round(window.innerWidth * 0.55),
        y: Math.round(window.innerHeight * 0.6),
      };
      pointer.style.transform = `translate(${start.x}px,${start.y}px)`;
      const glide = async (x: number, y: number) => {
        pointer.style.transform = `translate(${x}px,${y}px)`;
        await wait(glideMs);
      };
      const mark = async (x: number, y: number) => {
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        ring.animate(
          [
            { opacity: 1, transform: "scale(.5)" },
            { opacity: 0, transform: "scale(1.4)" },
          ],
          { duration: 450, easing: "ease-out" },
        );
        await wait(150);
      };
      const typeKeys = async (
        text: string,
        put: (key: string) => void,
        { speed = 1 }: { speed?: number } = {},
      ) => {
        let n = 0;
        for (const ch of text) {
          put(ch);
          // A typist's rhythm: about eight keys a second, a little uneven.
          await wait(
            (ch === " " ? 150 : 85 + (n++ % 3) * 20) / (speed * typing),
          );
        }
      };

      // The camera's log: each action's time, on the frames' clock, and
      // where it happens, in CSS px.
      const events: CameraEvent[] = [];
      const now = () => (performance.timeOrigin + performance.now()) / 1000;
      const rectOf = (b: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }): Rect => ({
        x: b.left,
        y: b.top,
        w: b.right - b.left,
        h: b.bottom - b.top,
      });
      const around = (rects: Rect[]): Rect | undefined => {
        if (rects.length === 0) return undefined;
        const x = Math.min(...rects.map((r) => r.x));
        const y = Math.min(...rects.map((r) => r.y));
        return {
          x,
          y,
          w: Math.max(...rects.map((r) => r.x + r.w)) - x,
          h: Math.max(...rects.map((r) => r.y + r.h)) - y,
        };
      };
      /** The caret's box, or the focused field's. */
      const caret = (): Rect | undefined => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
          return rectOf(el.getBoundingClientRect());
        const selection = document.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const boxes = range.getClientRects();
          const b =
            boxes.item(boxes.length - 1) ?? range.getBoundingClientRect();
          if (b.height > 0) return rectOf(b);
        }
        return el && el !== document.body
          ? rectOf(el.getBoundingClientRect())
          : undefined;
      };

      page.scratch.docsWalkPointer = {
        async point(el, { inset } = {}) {
          el.scrollIntoView({ block: "nearest", behavior: "instant" });
          const b = el.getBoundingClientRect();
          const x = Math.round(b.left + (inset ?? Math.min(b.width / 2, 120)));
          const y = Math.round(b.top + b.height / 2);
          await glide(x, y);
          events.push({ kind: "point", t: now(), x, y, rect: rectOf(b) });
          await mark(x, y);
        },
        async pointAt(x, y) {
          await glide(Math.round(x), Math.round(y));
          events.push({ kind: "point", t: now(), x, y });
          await mark(Math.round(x), Math.round(y));
        },
        async park(x, y) {
          await glide(Math.round(x), Math.round(y));
          events.push({ kind: "park", t: now(), x, y });
        },
        async type(input, text) {
          // The typist moves the pointer off the field, so it hides no letter.
          const b = input.getBoundingClientRect();
          pointer.style.transform = `translate(${Math.round(b.right - 40)}px,${Math.round(b.bottom + 16)}px)`;
          input.focus();
          const t = now();
          await typeKeys(text, (ch) => {
            input.value += ch;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          events.push({ kind: "type", t, end: now(), rect: rectOf(b) });
        },
        async keys(text, put, options) {
          const t = now();
          const before = caret();
          await typeKeys(text, put, options);
          const rect = around(
            [before, caret()].filter((r): r is Rect => r !== undefined),
          );
          events.push({ kind: "keys", t, end: now(), ...(rect && { rect }) });
        },
        async look(target, { padding } = {}) {
          const targets = (
            Array.isArray(target) ? target : [target]
          ) as readonly LookTarget[];
          // Only the part of each target inside the window counts: a hidden
          // or scrolled-out target would pull the view off the subject.
          const rect = around(
            targets
              .map((x) => {
                const b = x instanceof Element ? x.getBoundingClientRect() : x;
                return rectOf({
                  left: Math.max(b.left, 0),
                  top: Math.max(b.top, 0),
                  right: Math.min(b.right, window.innerWidth),
                  bottom: Math.min(b.bottom, window.innerHeight),
                });
              })
              .filter((r) => r.w > 0 && r.h > 0),
          );
          if (!rect) return;
          events.push({
            kind: "look",
            t: now(),
            rect,
            ...(padding !== undefined && { padding }),
          });
          // The camera's move to the look ends before the clip's rest.
          await wait(lookMs);
        },
      };
      page.scratch.docsWalkStopRecording = async () => {
        await cdp.sendCommand("Page.stopScreencast");
        cdp.removeListener("message", onMessage);
        // The clip's end, in the frames' clock: the last frame stands until now.
        const end = now();
        const origin = frames[0]?.t ?? end;
        return {
          frames: [...frames, { file: "", t: end }],
          camera: {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            events: events.map((e) =>
              "end" in e
                ? { ...e, t: e.t - origin, end: e.end - origin }
                : { ...e, t: e.t - origin },
            ),
          },
        };
      };
      await cdp.sendCommand("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      // The clip opens on the scene before the first action.
      await wait(opening);
    },
    {
      dir,
      opening: settings.opening * 1000,
      glideMs: settings.glide * 1000,
      typing: settings.typing,
      // With the camera off, a look moves nothing, so it does not wait.
      lookMs: settings.camera ? settings.ease * 1000 : 0,
    },
    { timeoutMs: 30000 },
  );
}

/**
 * The window of process `pid` whose title matches `title`: its CGWindowID,
 * its layer, and its screen area `x,y,w,h`. Throws unless that window is in
 * front of every other app's window over that area, so a capture holds
 * Zotero alone. macOS only.
 */
async function zoteroWindow(
  pid: number,
  title: RegExp,
): Promise<{ id: number; layer: number; bounds: string }> {
  const { stdout } = await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    // The on-screen windows, front to back, of the layers apps draw in.
    `ObjC.import("CoreGraphics"); const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)); const out = []; for (let i = 0; i < Number(a.count); i++) { const w = ObjC.deepUnwrap(a.objectAtIndex(i)); if (w.kCGWindowLayer >= 0 && w.kCGWindowLayer < 20) out.push({ id: w.kCGWindowNumber, layer: w.kCGWindowLayer, pid: w.kCGWindowOwnerPID, owner: w.kCGWindowOwnerName, name: w.kCGWindowName || "", b: w.kCGWindowBounds }); } JSON.stringify(out)`,
  ]);
  type Box = { X: number; Y: number; Width: number; Height: number };
  const windows = JSON.parse(stdout) as {
    id: number;
    layer: number;
    pid: number;
    owner: string;
    name: string;
    b: Box;
  }[];
  const at = windows.findIndex((w) => w.pid === pid && title.test(w.name));
  const found = windows[at];
  if (!found)
    throw new Error(
      `no Zotero window on screen titled ${String(title)}: ${JSON.stringify(windows.filter((w) => w.pid === pid))}`,
    );
  const meets = (a: Box, b: Box) =>
    a.X < b.X + b.Width &&
    b.X < a.X + a.Width &&
    a.Y < b.Y + b.Height &&
    b.Y < a.Y + a.Height;
  const over = windows
    .slice(0, at)
    .filter((w) => w.pid !== pid && w.b.Width > 0 && meets(w.b, found.b));
  if (over.length > 0)
    throw new Error(
      `the Zotero window ${String(title)} is behind ${over.map((w) => w.owner).join(", ")}; the clip would record them`,
    );
  const { X, Y, Width, Height } = found.b;
  return {
    id: found.id,
    layer: found.layer,
    bounds: [X, Y, Width, Height].map(Math.round).join(","),
  };
}

/**
 * Bring the app of process `pid` to the front. macOS window capture records
 * a window as black while its app is behind.
 */
async function activate(pid: number): Promise<void> {
  await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(1); ""`,
  ]);
}

/**
 * Draw a pointer in the Zotero window `window` (an expression) and glide it
 * to the element `element` (an expression over that window, `w`), with a
 * click mark there.
 */
async function zoteroPointer(
  zotero: ZoteroRdp,
  window: string,
  element: string,
): Promise<void> {
  if (!recordRequested()) return;
  await zotero.json<boolean>(`(async()=>{const w=${window};const d=w.document;
    const ns='http://www.w3.org/1999/xhtml';const wait=(ms)=>new Promise(r=>w.setTimeout(r,ms));
    let p=d.querySelector('[data-docs-walk-pointer="arrow"]');
    if(!p){p=d.createElementNS(ns,'div');p.setAttribute('data-docs-walk-pointer','arrow');
      p.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform 550ms cubic-bezier(.4,0,.2,1);transform:translate('+Math.round(w.innerWidth*0.5)+'px,'+Math.round(w.innerHeight*0.25)+'px)';
      p.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26" style="display:block"><path d="M2 1.5v20.2l5.3-5.1 3.4 7.8 3.4-1.5-3.3-7.6 7.4-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      d.documentElement.appendChild(p);await wait(300);}
    const e=${element};const b=e.getBoundingClientRect();
    const x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2);
    p.style.transform='translate('+x+'px,'+y+'px)';await wait(650);
    const r=d.createElementNS(ns,'div');r.setAttribute('data-docs-walk-pointer','ring');
    r.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid #7c5cff;background:rgba(124,92,255,.18);z-index:2147483646;pointer-events:none;';
    d.documentElement.appendChild(r);r.animate([{opacity:1,transform:'scale(.5)'},{opacity:0,transform:'scale(1.4)'}],{duration:450,easing:'ease-out',fill:'forwards'});
    await wait(200);return true;})()`);
}
