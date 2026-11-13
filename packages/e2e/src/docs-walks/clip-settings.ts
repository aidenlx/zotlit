// The settings of a docs-walk clip: how it is recorded and how its camera
// cuts it. Every value has its default here. A run overrides them with
// `DOCS_WALK_CLIP` (a JSON object) or `DOCS_WALK_CLIP_FILE` (a JSON file),
// for example `DOCS_WALK_CLIP='{"zoom":1.2,"rest":2.5}'`; a walk sets its own
// defaults through `openDocsWalk({ clip })`. Each take records the settings
// it used. See packages/e2e/AGENTS.md, "Docs walks".

import { readFileSync } from "node:fs";

export interface ClipSettings {
  /** Whether the camera frames each action; off keeps the whole window. */
  camera: boolean;
  /** The highest zoom of a shot; most shots keep the whole window. */
  zoom: number;
  /** How long a shot holds after its move, at least, in s. */
  hold: number;
  /** How long the opening shot of the whole window holds, at least, in s. */
  openHold: number;
  /** How long before a click the camera arrives, in s. */
  lead: number;
  /** How long one camera move takes, in s; `look` waits as long. */
  ease: number;
  /** The shortest camera move, when an action leaves less time, in s. */
  minEase: number;
  /** The share of each side of the view an action may fall in before the camera moves. */
  central: number;
  /** The margin kept around an element or a look region, in CSS px. */
  padding: number;
  /** The context a shot keeps around a click or a typing field, in CSS px. */
  context: number;
  /** The still start before the first action, in s. */
  opening: number;
  /** How long the clip rests on the result after the last action, in s. */
  rest: number;
  /** How long the encoder holds the first frame before the clip, in s. */
  openPad: number;
  /** How long the encoder holds the last frame after the clip, in s. */
  endPad: number;
  /** How long the pointer takes to glide to a target, in s. */
  glide: number;
  /** The typing pace, as a multiple of a person's pace. */
  typing: number;
  /** The widest output, in px; the height keeps the window's ratio. */
  width: number;
  /** The output frame rate. */
  fps: number;
  /** The poster's WebP quality. */
  posterQuality: number;
  /** The quality of the VP9 and H.264 encodes; a higher CRF is smaller. */
  vp9Crf: number;
  h264Crf: number;
}

export const defaultClipSettings: ClipSettings = {
  camera: true,
  zoom: 1.4,
  hold: 2.5,
  openHold: 1.5,
  lead: 0.5,
  ease: 1,
  minEase: 0.6,
  central: 1,
  padding: 32,
  context: 160,
  opening: 1,
  rest: 1.5,
  openPad: 0.8,
  endPad: 1,
  glide: 0.6,
  typing: 1,
  width: 1440,
  fps: 30,
  posterQuality: 82,
  // Clips with camera moves passed 1.5 MB at 30 and 20; at 42 and 32 the UI
  // text reads the same at the site's size.
  vp9Crf: 42,
  h264Crf: 32,
};

/**
 * The settings of this run: the defaults, then `base`, then the overrides in
 * `DOCS_WALK_CLIP_FILE` and `DOCS_WALK_CLIP`.
 */
export function clipSettings(base: Partial<ClipSettings> = {}): ClipSettings {
  const file = process.env.DOCS_WALK_CLIP_FILE;
  const inline = process.env.DOCS_WALK_CLIP;
  const settings: ClipSettings = {
    ...defaultClipSettings,
    ...base,
    ...(file &&
      (JSON.parse(readFileSync(file, "utf8")) as Partial<ClipSettings>)),
    ...(inline && (JSON.parse(inline) as Partial<ClipSettings>)),
  };
  for (const key of Object.keys(settings))
    if (!(key in defaultClipSettings))
      throw new Error(`unknown clip setting ${key}`);
  return settings;
}
