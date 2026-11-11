// The shared harness of the docs walks: each walk is one docs lesson, run as
// its reader would through the real apps. See packages/e2e/AGENTS.md, "Docs
// walks".

import { prepareRunWindow } from "@e2e/background-throttling.ts";
import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";
import { openPairedEnvironment } from "@e2e/paired-environment.ts";
import { openZoteroRdp } from "@e2e/paired-zotero.ts";
import type { ZoteroRdp } from "@e2e/paired-zotero.ts";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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
    docsWalkStopRecording?: () => Promise<RecordedFrame[]>;
  }
}

/** The pointer a recording draws, since the walk's clicks move no mouse. */
export interface DocsWalkPointer {
  /** Glide to `el` and show a click mark there. */
  point(el: Element): Promise<void>;
  /** Type `text` into `input` one key at a time, as a person types. */
  type(input: HTMLInputElement, text: string): Promise<void>;
}

/** One screencast frame on disk, at its capture time in epoch seconds. */
interface RecordedFrame {
  file: string;
  t: number;
}

/** How long a recording rests on the result after the last action, in seconds. */
const RECORD_REST = 1.5;

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

/** `DOCS_WALK_CAPTURE=1` turns a walk's planned shots into docs images. */
export function captureRequested(): boolean {
  return process.env.DOCS_WALK_CAPTURE === "1";
}

/** `DOCS_WALK_RECORD=1` turns a walk's planned clips into docs videos. */
export function recordRequested(): boolean {
  return process.env.DOCS_WALK_RECORD === "1";
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
   * result for 1.5 s. Without `DOCS_WALK_RECORD=1`, it only runs `actions`.
   */
  record<T>(name: string, actions: () => Promise<T>): Promise<T>;
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
  const images = join(
    root,
    "apps",
    "docs",
    "public",
    "img",
    options.collection,
  );

  const owned = stack.move();
  return {
    vaultId,
    zotero,
    async capture(layer, { notices = false } = {}) {
      if (!captureRequested()) return;
      await mkdir(captures, { recursive: true });
      // A notice is transient: the walk asserts it, and the image leaves it
      // out unless the notice is what the step shows.
      if (!notices) await clearNotices(vaultId);
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
    async record(name, actions) {
      if (!recordRequested()) return actions();
      const frames = join(captures, `${name}.frames`);
      await rm(frames, { recursive: true, force: true });
      await startRecording(vaultId, frames);
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions();
        await new Promise((r) => setTimeout(r, RECORD_REST * 1000));
      } finally {
        const recorded = await obRun(vaultId, async ({ page }) => {
          const stop = page.scratch.docsWalkStopRecording;
          delete page.scratch.docsWalkStopRecording;
          delete page.scratch.docsWalkPointer;
          for (const el of document.querySelectorAll(
            "[data-docs-walk-pointer]",
          ))
            el.remove();
          return stop ? await stop() : [];
        });
        await writeFile(
          join(frames, "frames.json"),
          JSON.stringify(recorded, null, 2),
        );
      }
      await mkdir(images, { recursive: true });
      await encodeClip(frames, join(images, name));
      return result;
    },
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

/**
 * Start a CDP screencast of the vault's window into `dir`, one PNG per
 * frame with its timestamp, and draw the pointer the walk's steps use.
 */
async function startRecording(vaultId: string, dir: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ page }, { dir }) => {
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
      pointer.style.cssText =
        "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform 550ms cubic-bezier(.4,0,.2,1);";
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
      page.scratch.docsWalkPointer = {
        async point(el) {
          el.scrollIntoView({ block: "nearest", behavior: "instant" });
          const b = el.getBoundingClientRect();
          const x = Math.round(b.left + Math.min(b.width / 2, 120));
          const y = Math.round(b.top + b.height / 2);
          pointer.style.transform = `translate(${x}px,${y}px)`;
          await wait(600);
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
        },
        async type(input, text) {
          // The typist moves the pointer off the field, so it hides no letter.
          const b = input.getBoundingClientRect();
          pointer.style.transform = `translate(${Math.round(b.left + Math.min(b.width / 2, 120) + 24)}px,${Math.round(b.bottom + 14)}px)`;
          input.focus();
          for (const ch of text) {
            input.value += ch;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            // A typist's rhythm: about eight keys a second, a little uneven.
            await wait(ch === " " ? 160 : 95 + (input.value.length % 3) * 20);
          }
        },
      };
      page.scratch.docsWalkStopRecording = async () => {
        await cdp.sendCommand("Page.stopScreencast");
        cdp.removeListener("message", onMessage);
        // The clip's end, in the frames' clock: the last frame stands until now.
        const end = (performance.timeOrigin + performance.now()) / 1000;
        return [...frames, { file: "", t: end }];
      };
      await cdp.sendCommand("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      // The clip opens on the scene before the first action.
      await wait(300);
    },
    { dir },
    { timeoutMs: 30000 },
  );
}

/**
 * Encode the frames in `dir` at their real timing as `<out>.webm` (VP9) and
 * `<out>.mp4` (H.264), 1440 px wide at most, 30 frames a second, no audio.
 */
async function encodeClip(dir: string, out: string): Promise<void> {
  const frames = JSON.parse(
    await readFile(join(dir, "frames.json"), "utf8"),
  ) as RecordedFrame[];
  const shown = frames.filter((f) => f.file);
  if (shown.length === 0) throw new Error(`no frames recorded in ${dir}`);
  const lines: string[] = [];
  shown.forEach((frame, i) => {
    const next = frames[i + 1] ?? frame;
    lines.push(
      `file '${frame.file}'`,
      `duration ${Math.max(next.t - frame.t, 0.001).toFixed(4)}`,
    );
  });
  // The concat demuxer drops the last duration unless the file repeats.
  lines.push(`file '${shown.at(-1)!.file}'`);
  const list = join(dir, "frames.txt");
  await writeFile(list, `${lines.join("\n")}\n`);
  const input = ["-y", "-f", "concat", "-safe", "0", "-i", list];
  // A Lanczos downscale to 1440 px keeps UI text crisp at 1x.
  const filter = [
    "-vf",
    "scale='min(1440,iw)':-2:flags=lanczos,format=yuv420p",
    "-fps_mode",
    "cfr",
    "-r",
    "30",
    "-an",
  ];
  await execFileAsync("ffmpeg", [
    ...input,
    ...filter,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-deadline",
    "good",
    "-cpu-used",
    "1",
    "-row-mt",
    "1",
    "-tune-content",
    "screen",
    `${out}.webm`,
  ]);
  await execFileAsync("ffmpeg", [
    ...input,
    ...filter,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-tune",
    "stillimage",
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    `${out}.mp4`,
  ]);
}
