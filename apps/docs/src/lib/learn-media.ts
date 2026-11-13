// The step pictures of the `/learn` lessons, as the build finds them on disk.
//
// A lesson names its media folder; each step's still is
// `public/img/learn/<folder>/step-<n>.webp`, and a step with a recording also
// has `step-<n>.mp4` beside it, and may have
// `step-<n>.poster.webp`, the clip's last frame framed on the result.
// Recordings arrive step by step, so the page reads which steps have one from
// this scan rather than from the lesson file. The scan runs in Node —
// `learnMediaPlugin` hands the result to the app as the `__LEARN_MEDIA__`
// define, and `vitest.config.ts` does the same for the tests. The clips come
// from the media store's scan (`scanVideos`). A file that is missing, or
// still a Git LFS pointer, leaves its step out instead of failing the build.

import { existsSync, globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizePath } from "vite";
import type { Plugin } from "vite";

import { scanVideos } from "./media-store.js";
import type { MediaSize, StoredVideo } from "./media-store.js";

/** One step's media: the still, and the recording when one exists. */
export interface StepMedia extends MediaSize {
  /** The size of `step-<n>.poster.webp`, when the step has one. */
  poster?: MediaSize;
  /** The step's `step-<n>.mp4`, when it has one. */
  clip?: {
    /** The clip's own size, when its MP4 header gives one; the still's otherwise. */
    size: MediaSize;
  };
}

/** Step media keyed by `<folder>/step-<n>`. */
export type LearnMedia = Record<string, StepMedia>;

const learnDir = "public/img/learn";

/** The size a WebP file's header declares, or undefined for anything else. */
export function webpSize(bytes: Uint8Array): MediaSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") {
    return undefined;
  }
  switch (text(12, 4)) {
    case "VP8 ":
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    case "VP8L": {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    case "VP8X": {
      const read24 = (at: number) =>
        bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    default:
      return undefined;
  }
}

/**
 * Every step still under `public/img/learn`, with its size and recording.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 * @param videos the media store's scan of the same root.
 */
export function scanLearnMedia(
  packageRoot: string,
  videos: readonly StoredVideo[] = scanVideos(packageRoot),
): LearnMedia {
  const clips = new Map(videos.map((video) => [video.path, video]));
  const root = resolve(packageRoot, learnDir);
  if (!existsSync(root)) return {};

  const media: LearnMedia = {};
  const stills = globSync("*/step-*.webp", { cwd: root })
    .map(normalizePath)
    .filter((file) => /\/step-\d+\.webp$/.test(file))
    .toSorted();
  for (const file of stills) {
    const key = file.replace(/\.webp$/, "");
    const size = webpSize(readFileSync(join(root, file)));
    if (!size) continue;

    const clip = clips.get(`/img/learn/${key}.mp4`);
    const posterPath = join(root, `${key}.poster.webp`);
    const poster = existsSync(posterPath)
      ? webpSize(readFileSync(posterPath))
      : undefined;

    media[key] = {
      ...size,
      ...(poster && { poster }),
      ...(clip && { clip: { size: clip.size ?? size } }),
    };
  }
  return media;
}

/**
 * Hands the scan to the app as `__LEARN_MEDIA__`, and rescans when a step's
 * media changes in dev.
 * @param videos the media store's scan; `vite.config.ts` shares one with `mediaStorePlugin`.
 */
export function learnMediaPlugin(
  packageRoot: string,
  videos: () => readonly StoredVideo[] = () => scanVideos(packageRoot),
): Plugin {
  const inventory = (scan: readonly StoredVideo[]) =>
    JSON.stringify(scanLearnMedia(packageRoot, scan));
  const mediaRoot = `${normalizePath(resolve(packageRoot, learnDir))}/`;
  return {
    name: "zotlit:learn-media",
    config() {
      return { define: { __LEARN_MEDIA__: inventory(videos()) } };
    },
    configureServer(server) {
      // A change on disk needs a new scan, not the one the config was built from.
      async function refresh(path: string) {
        if (!normalizePath(path).startsWith(mediaRoot)) return;
        const fresh = inventory(scanVideos(packageRoot));
        if (server.config.define?.__LEARN_MEDIA__ !== fresh) {
          await server.restart();
        }
      }
      server.watcher
        .on("add", (path) => void refresh(path))
        .on("change", (path) => void refresh(path))
        .on("unlink", (path) => void refresh(path));
    },
  };
}
