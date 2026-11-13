// The encoder of the docs-walk clips. It bakes the camera into a recording:
// each output frame is the screencast frame shown at that time, cropped to
// the camera's view and scaled to the window's ratio, 1440 px wide for a
// lesson's 1440 × 860 window. It runs alone too, to cut a clip again from its
// saved frames (`.scratch/docs-walks/<slug>/<name>.frames/`, out of git) with
// another track or other settings, without a new recording:
//
//   node packages/e2e/src/docs-walks/clip-encode.ts <frames-dir> <out> [<track.json>|whole]
//
// writes <out>.mp4 and <out>.poster.webp, with the planned track
// unless a track file, or `whole` for the whole window, is named. The
// recording's own settings are those the clip was recorded with; the camera
// and the pads are those of this run, today's defaults under the overrides
// of `DOCS_WALK_CLIP` and `DOCS_WALK_CLIP_FILE` (see clip-settings.ts).

import { execFile } from "node:child_process";
import { access, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { closingPad, openingPad, planCamera, viewAt } from "./camera.ts";
import type { CameraEvent, CameraTrack } from "./camera.ts";
import {
  cutKeys,
  defaultClipSettings,
  recutSettings,
} from "./clip-settings.ts";
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
  /**
   * Parts of the frame to blur in all of the shot's frames, in the
   * viewport's units: a desktop shot's private parts, such as the menu
   * bar's status area.
   */
  blur?: BlurRegion[];
}

/** A part of a shot's frames that the encoder blurs. */
export interface BlurRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Blur `regions` (source px) of the raw RGB image `image` in place, so
 * strongly that no text or icon in them stays legible.
 */
async function blurRegions(
  image: Buffer,
  size: { width: number; height: number },
  regions: { left: number; top: number; width: number; height: number }[],
): Promise<void> {
  const raw = { width: size.width, height: size.height, channels: 3 as const };
  for (const r of regions) {
    const left = Math.max(0, Math.round(r.left));
    const top = Math.max(0, Math.round(r.top));
    const width = Math.min(size.width - left, Math.round(r.width));
    const height = Math.min(size.height - top, Math.round(r.height));
    if (width <= 0 || height <= 0) continue;
    const blurred = await sharp(image, { raw })
      .extract({ left, top, width, height })
      .blur(40)
      .raw()
      .toBuffer();
    for (let y = 0; y < height; y++)
      blurred.copy(
        image,
        ((top + y) * size.width + left) * 3,
        y * width * 3,
        (y + 1) * width * 3,
      );
  }
}

/**
 * A clip made of several shots, `sequence.json` in a clip's frames folder:
 * each shot is a folder of frames beside it, with its own camera log, cut
 * one after the other into one clip. A shot names `track.json` (a file in
 * its folder) to keep the track it was recorded with, or `whole`.
 */
export interface ClipSequence {
  shots: { dir: string; track?: string }[];
}

/** One shot's frames, log and duration, from its folder. */
async function readShot(dir: string) {
  const frames = JSON.parse(
    await readFile(join(dir, "frames.json"), "utf8"),
  ) as RecordedFrame[];
  const shown = frames.filter((f) => f.file);
  if (shown.length === 0) throw new Error(`no frames recorded in ${dir}`);
  const log = JSON.parse(
    await readFile(join(dir, "camera.json"), "utf8"),
  ) as CameraLog;
  const start = shown[0]!.t;
  return { shown, log, start, duration: frames.at(-1)!.t - start };
}

/**
 * Encode the frames in `dir` as `<out>.mp4` (H.264) and the final frame
 * `<out>.poster.webp`, at their real timing, through the
 * camera track: `track` when given, `"whole"` for the whole window
 * throughout, or the plan of the clip's `camera.json`. `settings` default to
 * the recording's own settings with this run's camera and pads
 * ({@link recutSettings}); with the camera off, the clip keeps the whole
 * window and has no poster. The first image holds `openPad` before the clip,
 * or longer, so the opening shot rests `hold` ({@link openingPad}), and the
 * last `endPad` after it, or longer, so the shot after the last move rests
 * `hold` ({@link closingPad}); the track's times stay those of the frames.
 * The track
 * used is written to `dir/track.json` and answered with the clip's log.
 * A `dir` with a `sequence.json` is a clip of several shots
 * ({@link ClipSequence}); it answers the track and log of its last shot.
 */
export async function encodeClip(
  dir: string,
  out: string,
  {
    track,
    settings,
  }: { track?: CameraTrack | "whole"; settings?: ClipSettings } = {},
): Promise<{ track: CameraTrack; log: CameraLog; settings: ClipSettings }> {
  const sequence = await readFile(join(dir, "sequence.json"), "utf8").then(
    (text) => JSON.parse(text) as ClipSequence,
    () => undefined,
  );
  const shots = sequence
    ? await Promise.all(
        sequence.shots.map(async (shot) => ({
          dir: join(dir, shot.dir),
          track:
            shot.track === "whole"
              ? ("whole" as const)
              : shot.track
                ? await readTrack(join(dir, shot.dir, shot.track))
                : undefined,
        })),
      )
    : [{ dir, track }];

  const baked = join(dir, "baked");
  await rm(baked, { recursive: true, force: true });
  await mkdir(baked, { recursive: true });
  let size: { outW: number; outH: number } | undefined;
  let tick = 0;
  let openTicks = 0;
  let image = 0;
  let last: Awaited<ReturnType<typeof bakeShot>> | undefined;
  let s: ClipSettings | undefined;
  let lastDuration = 0;
  for (const shot of shots) {
    const read = await readShot(shot.dir);
    s ??= settings ?? recutSettings(read.log.settings ?? {});
    const { width: W, height: H } = read.log.viewport;
    // The clip is `width` px wide at most, at the first shot's ratio, in
    // even px.
    if (!size) {
      const first = await sharp(join(shot.dir, read.shown[0]!.file)).metadata();
      const outW = Math.min(s.width, first.width);
      size = { outW, outH: 2 * Math.round((outW * H) / W / 2) };
    }
    const used =
      shot.track === "whole" || !s.camera
        ? { keyframes: [{ t: 0, view: { x: 0, y: 0, w: W, h: H } }] }
        : (shot.track ??
          planCamera(
            {
              viewport: read.log.viewport,
              duration: read.duration,
              events: read.log.events,
            },
            s,
          ));
    await writeFile(
      join(shot.dir, "track.json"),
      `${JSON.stringify(used, null, 2)}\n`,
    );
    // The clip's first ticks are the open pad, after the shots, long enough
    // that the opening shot rests `hold`.
    if (shot === shots[0]) {
      openTicks = Math.ceil(openingPad(used, s) * s.fps - 1e-6);
      tick = openTicks;
    }
    last = await bakeShot({
      dir: shot.dir,
      read,
      used,
      s,
      size,
      baked,
      from: { tick, image },
    });
    tick = last.tick;
    image = last.image;
    // The shot's length in whole ticks, as baked.
    lastDuration = Math.max(1, Math.round(read.duration * s.fps)) / s.fps;
  }
  // The open pad holds the clip's first image, and the end pad its last,
  // long enough that the closing shot rests `hold`.
  for (let n = 0; n < openTicks; n++)
    await link(
      join(baked, "b00000.png"),
      join(baked, `t${String(n).padStart(5, "0")}.png`),
    );
  const endPad = closingPad(last!.track, lastDuration, s!);
  for (let n = 0; n < Math.ceil(endPad * s!.fps - 1e-6); n++)
    await link(
      join(baked, last!.lastFile),
      join(baked, `t${String(tick++).padStart(5, "0")}.png`),
    );
  await encodeMp4(
    {
      input: [
        "-y",
        "-framerate",
        String(s!.fps),
        "-i",
        join(baked, "t%05d.png"),
      ],
      filter: "format=yuv420p",
    },
    out,
    s!,
  );
  if (s!.camera)
    await sharp(join(baked, last!.lastFile))
      .webp({ quality: s!.posterQuality })
      .toFile(`${out}.poster.webp`);
  return { track: last!.track, log: last!.log, settings: s! };
}

/**
 * Bake one shot into `baked`: one image per tick from `tick` on, each the
 * screencast frame shown at that time, cropped to the camera's view and
 * scaled to the clip's size.
 */
async function bakeShot({
  dir,
  read,
  used,
  s,
  size: { outW, outH },
  baked,
  from,
}: {
  dir: string;
  read: Awaited<ReturnType<typeof readShot>>;
  used: CameraTrack;
  s: ClipSettings;
  size: { outW: number; outH: number };
  baked: string;
  /** The first tick and image number of the shot. */
  from: { tick: number; image: number };
}): Promise<{
  tick: number;
  image: number;
  lastFile: string;
  track: CameraTrack;
  log: CameraLog;
}> {
  const { shown, log, start, duration } = read;
  let { tick, image } = from;
  const { width: W, height: H } = log.viewport;
  const first = await sharp(join(dir, shown[0]!.file)).metadata();
  const scale = first.width / W;
  const sourceW = first.width;
  const sourceH = first.height;

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

  let source: { frame: number; image: Buffer } | undefined;
  // Each tick is one file, a hard link to its shot's image, so ffmpeg reads
  // the clip at exactly `fps`: a concat list rounds its times to 1/25 s and
  // makes a camera move judder.
  let lastFile = "";
  for (const shot of shots) {
    if (source?.frame !== shot.frame) {
      source = {
        frame: shot.frame,
        image: await sharp(join(dir, shown[shot.frame]!.file))
          .removeAlpha()
          .raw()
          .toBuffer(),
      };
      // The private parts this frame shows, blurred before the crop.
      const regions = (log.blur ?? []).map((b) => ({
        left: b.x * scale,
        top: b.y * scale,
        width: b.w * scale,
        height: b.h * scale,
      }));
      if (regions.length > 0)
        await blurRegions(
          source.image,
          { width: sourceW, height: sourceH },
          regions,
        );
    }
    lastFile = `b${String(image++).padStart(5, "0")}.png`;
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
      .toFile(join(baked, lastFile));
    for (let n = 0; n < shot.ticks; n++)
      await link(
        join(baked, lastFile),
        join(baked, `t${String(tick++).padStart(5, "0")}.png`),
      );
  }
  return { tick, image, lastFile, track: used, log };
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
  // The open pad holds the first frame, and the end pad the last.
  const pads = `tpad=start_mode=clone:start_duration=${s.openPad}:stop_mode=clone:stop_duration=${s.endPad}`;
  await encodeMp4(
    {
      input: ["-y", "-i", movie],
      filter: `${filter},${pads},format=yuv420p`,
    },
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
 * Encode `input` through `filter` as `<out>.mp4` (H.264) at the settings'
 * frame rate and quality, no audio, tuned for sharp UI text.
 */
async function encodeMp4(
  { input, filter }: { input: string[]; filter: string },
  out: string,
  s: ClipSettings,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    ...input,
    "-vf",
    filter,
    "-fps_mode",
    "cfr",
    "-r",
    String(s.fps),
    "-an",
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
  const recorded = Object.keys(defaultClipSettings).filter(
    (key) => !(cutKeys as readonly string[]).includes(key),
  );
  const {
    dir,
    out,
    track: trackFile,
  } = await yargs(hideBin(process.argv))
    .scriptName("clip-encode.ts")
    .usage(
      "$0 <dir> <out> [track]\n\nCut a docs-walk clip again from its saved frames, without a new recording.",
    )
    .positional("dir", {
      describe:
        "The clip's frames folder, .scratch/docs-walks/<slug>/step-<n>.frames",
      type: "string",
      demandOption: true,
    })
    .positional("out", {
      describe:
        "The output path without its extension; writes <out>.mp4 and <out>.poster.webp",
      type: "string",
      demandOption: true,
    })
    .positional("track", {
      describe:
        "A camera track file in the format of <dir>/track.json, or `whole` for the whole window; the camera plans the track when it is left out",
      type: "string",
    })
    .command("$0 <dir> <out> [track]", false)
    .epilogue(
      [
        `Today's settings, from clip-settings.ts under the overrides below: ${cutKeys.join(", ")}.`,
        `The recording's own settings, from <dir>/camera.json: ${recorded.join(", ")}.`,
        "",
        "DOCS_WALK_CLIP: a JSON object of settings that overrides both, such as '{\"zoom\":1.2}'.",
        "DOCS_WALK_CLIP_FILE: a JSON file of the same, applied under DOCS_WALK_CLIP.",
        "",
        "The track used is written to <dir>/track.json. See packages/e2e/AGENTS.md, Docs walks.",
      ].join("\n"),
    )
    .strict()
    .version(false)
    .parse();
  await encodeClip(dir, out, {
    track:
      trackFile === "whole"
        ? "whole"
        : trackFile
          ? await readTrack(trackFile)
          : undefined,
  });
}
