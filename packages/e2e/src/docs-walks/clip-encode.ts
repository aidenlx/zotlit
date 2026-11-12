// The encoder of the docs-walk clips. It bakes the camera into a recording:
// each output frame is the screencast frame shown at that time, cropped to
// the camera's view and scaled to the window's ratio, 1440 px wide for a
// lesson's 1440 × 860 window. It runs alone too, to cut a clip again from its
// saved frames (`.scratch/docs-walks/<slug>/<name>.frames/`, out of git) with
// another track or other settings, without a new recording:
//
//   node packages/e2e/src/docs-walks/clip-encode.ts <frames-dir> <out> [<track.json>|whole]
//
// writes <out>.webm, <out>.mp4 and <out>.poster.webp, with the planned track
// unless a track file, or `whole` for the whole window, is named. The
// settings are those the clip was recorded with, under the overrides of
// `DOCS_WALK_CLIP` and `DOCS_WALK_CLIP_FILE` (see clip-settings.ts).

import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

import { planCamera, viewAt } from "./camera.ts";
import type { CameraEvent, CameraTrack } from "./camera.ts";
import { clipSettings } from "./clip-settings.ts";
import type { ClipSettings } from "./clip-settings.ts";

const execFileAsync = promisify(execFile);

/** One screencast frame on disk, at its capture time in epoch seconds. */
export interface RecordedFrame {
  file: string;
  t: number;
}

/** The action log of a clip, `camera.json` beside its frames. */
export interface CameraLog {
  /** The window size, in CSS px. */
  viewport: { width: number; height: number };
  /** Event times are clip seconds, from the first frame. */
  events: CameraEvent[];
  /** The settings the clip was recorded with. */
  settings?: ClipSettings;
}

/**
 * Encode the frames in `dir` as `<out>.webm` (VP9), `<out>.mp4` (H.264) and
 * the final frame `<out>.poster.webp`, at their real timing, through the
 * camera track: `track` when given, `"whole"` for the whole window
 * throughout, or the plan of the clip's `camera.json`. `settings` default to
 * those the clip was recorded with, under this run's overrides; with the
 * camera off, the clip keeps the whole window and has no poster. The track
 * used is written to `dir/track.json` and answered with the clip's log.
 */
export async function encodeClip(
  dir: string,
  out: string,
  {
    track,
    settings,
  }: { track?: CameraTrack | "whole"; settings?: ClipSettings } = {},
): Promise<{ track: CameraTrack; log: CameraLog; settings: ClipSettings }> {
  const frames = JSON.parse(
    await readFile(join(dir, "frames.json"), "utf8"),
  ) as RecordedFrame[];
  const shown = frames.filter((f) => f.file);
  if (shown.length === 0) throw new Error(`no frames recorded in ${dir}`);
  const log = JSON.parse(
    await readFile(join(dir, "camera.json"), "utf8"),
  ) as CameraLog;
  const start = shown[0]!.t;
  const duration = frames.at(-1)!.t - start;
  const { width: W, height: H } = log.viewport;
  const s = settings ?? clipSettings(log.settings);
  const used =
    track === "whole" || !s.camera
      ? { keyframes: [{ t: 0, view: { x: 0, y: 0, w: W, h: H } }] }
      : (track ??
        planCamera(
          { viewport: log.viewport, duration, events: log.events },
          s,
        ));
  await writeFile(
    join(dir, "track.json"),
    `${JSON.stringify(used, null, 2)}\n`,
  );

  const first = await sharp(join(dir, shown[0]!.file)).metadata();
  const scale = first.width / W;
  const sourceW = first.width;
  const sourceH = first.height;
  // The clip is `width` px wide at most, at the window's ratio, in even px.
  const outW = Math.min(s.width, sourceW);
  const outH = 2 * Math.round((outW * H) / W / 2);

  // One output frame per tick; a run of ticks with the same source frame
  // and crop becomes one image held for the run.
  type Shot = {
    frame: number;
    left: number;
    top: number;
    width: number;
    height: number;
    ticks: number;
  };
  const shots: Shot[] = [];
  let at = 0;
  const ticks = Math.max(1, Math.round(duration * s.fps));
  for (let i = 0; i < ticks; i++) {
    const t = i / s.fps;
    while (at + 1 < shown.length && shown[at + 1]!.t - start <= t) at++;
    const v = viewAt(used, t);
    const width = Math.min(sourceW, Math.round(v.w * scale));
    const height = Math.min(sourceH, Math.round((width * H) / W));
    const left = Math.min(
      Math.max(0, Math.round(v.x * scale)),
      sourceW - width,
    );
    const top = Math.min(
      Math.max(0, Math.round(v.y * scale)),
      sourceH - height,
    );
    const last = shots.at(-1);
    if (
      last &&
      last.frame === at &&
      last.left === left &&
      last.top === top &&
      last.width === width
    )
      last.ticks++;
    else shots.push({ frame: at, left, top, width, height, ticks: 1 });
  }

  const baked = join(dir, "baked");
  await rm(baked, { recursive: true, force: true });
  await mkdir(baked, { recursive: true });
  let source: { frame: number; image: Buffer } | undefined;
  const lines: string[] = [];
  for (const [i, shot] of shots.entries()) {
    if (source?.frame !== shot.frame)
      source = {
        frame: shot.frame,
        image: await sharp(join(dir, shown[shot.frame]!.file))
          .removeAlpha()
          .raw()
          .toBuffer(),
      };
    const file = `b${String(i).padStart(5, "0")}.png`;
    await sharp(source.image, {
      raw: { width: sourceW, height: sourceH, channels: 3 },
    })
      .extract({
        left: shot.left,
        top: shot.top,
        width: shot.width,
        height: shot.height,
      })
      .resize(outW, outH, { kernel: "lanczos3", fit: "fill" })
      .png({ compressionLevel: 1 })
      .toFile(join(baked, file));
    lines.push(`file '${file}'`, `duration ${(shot.ticks / s.fps).toFixed(4)}`);
  }
  const lastFile = `b${String(shots.length - 1).padStart(5, "0")}.png`;
  // The concat demuxer drops the last duration unless the file repeats.
  lines.push(`file '${lastFile}'`);
  const list = join(baked, "frames.txt");
  await writeFile(list, `${lines.join("\n")}\n`);
  await encodeBoth(
    {
      input: ["-y", "-f", "concat", "-safe", "0", "-i", list],
      filter: "format=yuv420p",
    },
    out,
    s,
  );
  if (s.camera)
    await sharp(join(baked, lastFile))
      .webp({ quality: s.posterQuality })
      .toFile(`${out}.poster.webp`);
  return { track: used, log, settings: s };
}

/**
 * Encode a screen capture as {@link encodeClip} encodes a screencast, with
 * `inset` px cut from each edge and no camera; its last frame becomes
 * `<out>.poster.webp`.
 */
export async function encodeMovie(
  movie: string,
  out: string,
  { inset, settings: s }: { inset: number; settings: ClipSettings },
): Promise<void> {
  const crop = inset > 0 ? `crop=iw-${2 * inset}:ih-${2 * inset},` : "";
  const filter = `${crop}scale='min(${s.width},iw)':-2:flags=lanczos`;
  await encodeBoth(
    { input: ["-y", "-i", movie], filter: `${filter},format=yuv420p` },
    out,
    s,
  );
  const last = `${out}.poster.png`;
  await execFileAsync("ffmpeg", [
    "-y",
    "-sseof",
    "-0.5",
    "-i",
    movie,
    "-vf",
    filter,
    "-update",
    "1",
    last,
  ]);
  await sharp(last)
    .webp({ quality: s.posterQuality })
    .toFile(`${out}.poster.webp`);
  await rm(last, { force: true });
}

/**
 * Encode `input` through `filter` as `<out>.webm` (VP9) and `<out>.mp4`
 * (H.264) at the settings' frame rate and quality, no audio, tuned for sharp
 * UI text.
 */
async function encodeBoth(
  { input, filter }: { input: string[]; filter: string },
  out: string,
  s: ClipSettings,
): Promise<void> {
  const shared = [
    ...input,
    "-vf",
    filter,
    "-fps_mode",
    "cfr",
    "-r",
    String(s.fps),
    "-an",
  ];
  await execFileAsync("ffmpeg", [
    ...shared,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    String(s.vp9Crf),
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
    ...shared,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(s.h264Crf),
    "-tune",
    "stillimage",
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    `${out}.mp4`,
  ]);
}

/** The hand-written track `file`, or undefined when there is none. */
export async function readTrack(
  file: string,
): Promise<CameraTrack | undefined> {
  return access(file).then(
    async () => JSON.parse(await readFile(file, "utf8")) as CameraTrack,
    () => undefined,
  );
}

if (import.meta.main) {
  const [dir, out, trackFile] = process.argv.slice(2);
  if (!dir || !out)
    throw new Error(
      "usage: clip-encode.ts <frames-dir> <out> [<track.json>|whole]",
    );
  await encodeClip(dir, out, {
    track:
      trackFile === "whole"
        ? "whole"
        : trackFile
          ? await readTrack(trackFile)
          : undefined,
  });
}
