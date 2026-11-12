// The take record of the docs-walk clips: how each clip was recorded, kept
// in git beside the walk as `<slug>.takes.json`, while the footage stays out.
// A take holds what a new encode or a longer edit needs: the logged actions,
// the camera track the clip was cut with, the recorder's commit, the app
// versions, the command, and the clip's length and output sizes.

import { execFile } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";

import type { CameraEvent, CameraTrack } from "./camera.ts";
import type { ClipSettings } from "./clip-settings.ts";

const execFileAsync = promisify(execFile);

/** The files whose code records and cuts a clip. */
const RECORDER = [
  "packages/e2e/src/docs-walks/docs-walk.ts",
  "packages/e2e/src/docs-walks/camera.ts",
  "packages/e2e/src/docs-walks/clip-encode.ts",
];

/** One recorded clip. */
export interface Take {
  recordedAt: string;
  /** The walk's step (its test name) that records the clip. */
  step: string;
  /**
   * How to make the clip again: `build`, then `record` records this clip
   * alone (the walk runs every step, as the steps build on each other), and
   * `recut` cuts it again from the saved frames, while they last.
   */
  recipe: { build: string; record: string; recut?: string };
  /** The switches the run had, `DOCS_WALK_*` and nothing else. */
  env: Record<string, string>;
  /** The End-to-end Run version pin did not match the running Obsidian. */
  versionGateBypass: boolean;
  /** The last commit of the recorder's files, and whether they had edits. */
  recorder: { commit: string; edited: boolean };
  apps: { obsidian: string; obsidianPin: string; zotero: string };
  vaultCase: string;
  window: { width: number; height: number };
  /** A CDP screencast of Obsidian, or a macOS capture of a Zotero window. */
  source: "obsidian-screencast" | "zotero-window";
  /** Where the raw frames or movie were saved, out of git. */
  frames: string;
  /** The clip settings it was recorded and cut with. */
  settings: ClipSettings;
  /** The clip's length in seconds, and each output's size in bytes. */
  duration: number;
  outputs: Record<string, number>;
  camera?: {
    /** Where the track came from: the planner, a hand override, or none. */
    track: "planned" | "override" | "whole";
    viewport: { width: number; height: number };
    events: CameraEvent[];
    keyframes: CameraTrack["keyframes"];
  };
}

/** What a take shares with every other take of the run. */
export type TakeRun = Pick<
  Take,
  "env" | "versionGateBypass" | "recorder" | "apps" | "vaultCase" | "window"
>;

/**
 * The facts of this run that every take repeats. `running` is the Obsidian
 * version the app reports; the pin is read from the committed
 * `vault-script.ts`, so a local edit of the pin shows as a bypass.
 */
export async function takeRun(
  root: string,
  options: {
    slug: string;
    running: string;
    zotero: string;
    vaultCase: string;
    window: { width: number; height: number };
  },
): Promise<TakeRun> {
  const git = async (...args: string[]) =>
    (await execFileAsync("git", ["-C", root, ...args])).stdout.trim();
  const committed = await git(
    "show",
    "HEAD:packages/e2e/src/vault-script.ts",
  ).catch(() => "");
  const pin = /OBSIDIAN_VERSION = "([^"]+)"/.exec(committed)?.[1] ?? "";
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] =>
        e[0].startsWith("DOCS_WALK_") && e[1] !== undefined,
    ),
  );
  return {
    env,
    versionGateBypass: pin !== options.running,
    recorder: {
      commit: await git("log", "-1", "--format=%H", "--", ...RECORDER),
      edited: (await git("status", "--porcelain", "--", ...RECORDER)) !== "",
    },
    apps: {
      obsidian: options.running,
      obsidianPin: pin,
      zotero: options.zotero,
    },
    vaultCase: options.vaultCase,
    window: options.window,
  };
}

/**
 * The commands that make the clip `name` of the walk `slug` again, run from
 * the workspace root. `frames` is the frames folder of a screencast clip.
 */
export function takeRecipe(
  root: string,
  options: { slug: string; name: string; out: string; frames?: string },
): Take["recipe"] {
  const { slug, name, out, frames } = options;
  return {
    build:
      "pnpm exec turbo run build:dev --filter=@zotlit/obsidian --filter=@zotlit/zotero",
    record: `DOCS_WALK_RECORD=1 DOCS_WALK_ONLY=${name} pnpm --filter @zotlit/e2e docs-walk src/docs-walks/${slug}.walk.ts`,
    ...(frames && {
      recut: `node packages/e2e/src/docs-walks/clip-encode.ts ${relative(root, frames)} ${relative(root, out)}`,
    }),
  };
}

/** The size in bytes of each output of the clip `out` that exists. */
export async function outputSizes(
  root: string,
  out: string,
): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const ext of ["webm", "mp4", "poster.webp"]) {
    const file = `${out}.${ext}`;
    const size = await stat(file).then(
      (s) => s.size,
      () => undefined,
    );
    if (size !== undefined) sizes[relative(root, file)] = size;
  }
  return sizes;
}

/** The length in seconds of the video `file`. */
export async function videoLength(file: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Math.round(Number(stdout.trim()) * 1000) / 1000;
}

/** Write `take` as the clip `name` into the take record `file`. */
export async function writeTake(
  file: string,
  name: string,
  take: Take,
): Promise<void> {
  const takes: Record<string, Take> = await access(file).then(
    async () =>
      JSON.parse(await readFile(file, "utf8")) as Record<string, Take>,
    () => ({}),
  );
  takes[name] = take;
  const sorted = Object.fromEntries(
    Object.entries(takes).toSorted(([a], [b]) =>
      a.localeCompare(b, "en", { numeric: true }),
    ),
  );
  await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
