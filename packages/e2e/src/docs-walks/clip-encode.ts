// The encoder of the docs-walk clips. It bakes the camera into a recording:
// each output frame is the screencast frame shown at that time, cropped to
// the camera's view and scaled to the window's ratio, 1440 px wide for a
// lesson's 1440 × 860 window. It runs alone too, so a
// camera plan can be tuned on saved frames without a new recording:
//
//   node packages/e2e/src/docs-walks/clip-encode.ts <frames-dir> <out> [<track.json>]
//
// writes <out>.webm, <out>.mp4 and <out>.poster.webp from <frames-dir>, with
// the planned track unless a track file, or `whole` for the whole window, is
// named.

import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

import { planCamera, viewAt } from "./camera.ts";
import type { CameraEvent, CameraTrack } from "./camera.ts";

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
}

/** The output frame rate. */
const FPS = 30;
/** The widest clip, in px. */
const MAX_WIDTH = 1440;
/** The poster's WebP quality. */
const POSTER_QUALITY = 82;

/**
 * Encode the frames in `dir` as `<out>.webm` (VP9), `<out>.mp4` (H.264) and
 * the final frame `<out>.poster.webp`, 1440 px wide at most, at their real
 * timing, through the camera track: `track` when given, `"whole"` for the
 * whole window throughout, or the plan of the clip's `camera.json`. The track
 * used is written to `dir/track.json`. `poster: false` leaves the poster out.
 */
export async function encodeClip(
  dir: string,
  out: string,
  {
    track,
    poster = true,
  }: { track?: CameraTrack | "whole"; poster?: boolean } = {},
): Promise<void> {
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
  const used =
    track === "whole"
      ? { keyframes: [{ t: 0, view: { x: 0, y: 0, w: W, h: H } }] }
      : (track ??
        planCamera({ viewport: log.viewport, duration, events: log.events }));
  await writeFile(
    join(dir, "track.json"),
    `${JSON.stringify(used, null, 2)}\n`,
  );

  const first = await sharp(join(dir, shown[0]!.file)).metadata();
  const scale = first.width / W;
  const sourceW = first.width;
  const sourceH = first.height;
  // The clip is 1440 px wide at most, at the window's ratio, in even px.
  const outW = Math.min(MAX_WIDTH, sourceW);
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
  const ticks = Math.max(1, Math.round(duration * FPS));
  for (let i = 0; i < ticks; i++) {
    const t = i / FPS;
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
    lines.push(`file '${file}'`, `duration ${(shot.ticks / FPS).toFixed(4)}`);
  }
  const lastFile = `b${String(shots.length - 1).padStart(5, "0")}.png`;
  // The concat demuxer drops the last duration unless the file repeats.
  lines.push(`file '${lastFile}'`);
  const list = join(baked, "frames.txt");
  await writeFile(list, `${lines.join("\n")}\n`);
  await encodeBoth(
    ["-y", "-f", "concat", "-safe", "0", "-i", list],
    "format=yuv420p",
    out,
  );
  if (poster)
    await sharp(join(baked, lastFile))
      .webp({ quality: POSTER_QUALITY })
      .toFile(`${out}.poster.webp`);
}

/**
 * Encode a screen capture as {@link encodeClip} encodes a screencast, with
 * `inset` px cut from each edge and no camera, 1440 px wide at most; its last
 * frame becomes `<out>.poster.webp`.
 */
export async function encodeMovie(
  movie: string,
  out: string,
  inset: number,
): Promise<void> {
  const crop = inset > 0 ? `crop=iw-${2 * inset}:ih-${2 * inset},` : "";
  const filter = `${crop}scale='min(1440,iw)':-2:flags=lanczos`;
  await encodeBoth(["-y", "-i", movie], `${filter},format=yuv420p`, out);
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
    .webp({ quality: POSTER_QUALITY })
    .toFile(`${out}.poster.webp`);
  await rm(last, { force: true });
}

/**
 * Encode `input` through `filter` as `<out>.webm` (VP9) and `<out>.mp4`
 * (H.264), 30 frames a second, no audio, tuned for sharp UI text.
 */
async function encodeBoth(
  input: string[],
  filter: string,
  out: string,
): Promise<void> {
  const shared = [
    ...input,
    "-vf",
    filter,
    "-fps_mode",
    "cfr",
    "-r",
    String(FPS),
    "-an",
  ];
  await execFileAsync("ffmpeg", [
    ...shared,
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
    ...shared,
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
    throw new Error("usage: clip-encode.ts <frames-dir> <out> [<track.json>]");
  await encodeClip(dir, out, {
    track:
      trackFile === "whole"
        ? "whole"
        : trackFile
          ? await readTrack(trackFile)
          : undefined,
  });
}
