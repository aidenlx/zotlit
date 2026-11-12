// The step pictures of the `/learn` lessons, as the build finds them on disk.
//
// A lesson names its media folder; each step's still is
// `public/img/learn/<folder>/step-<n>.webp`, and a step with a recording also
// has `step-<n>.webm` and/or `step-<n>.mp4` beside it, and may have
// `step-<n>.poster.webp`, the clip's last frame framed on the result.
// Recordings arrive step by step, so the page reads which steps have one from
// this scan rather than from the lesson file. The scan runs in Node —
// `learnMediaPlugin` hands the result to the app as the `__LEARN_MEDIA__`
// define, and `vitest.config.ts` does the same for the tests. A file that is
// missing, or still a Git LFS pointer, leaves its step out instead of failing
// the build.

import { existsSync, globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizePath } from "vite";
import type { Plugin } from "vite";

/** A picture's pixel size. */
export interface MediaSize {
  width: number;
  height: number;
}

/** One step's media: the still, and the recording when one exists. */
export interface StepMedia extends MediaSize {
  /** The size of `step-<n>.poster.webp`, when the step has one. */
  poster?: MediaSize;
  clip?: {
    /** The clip's own size, when its MP4 header gives one; the still's otherwise. */
    size: MediaSize;
    webm: boolean;
    mp4: boolean;
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
 * The display size of an MP4's first video track, from its `tkhd` box, or
 * undefined when the file declares none.
 */
export function mp4Size(bytes: Uint8Array): MediaSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tkhd = [0x74, 0x6b, 0x68, 0x64];
  for (let at = 4; at + 4 <= bytes.length; at++) {
    if (tkhd.some((byte, i) => bytes[at + i] !== byte)) continue;
    const body = at + 4;
    // Version 1 headers carry 64-bit times, which moves the size 12 bytes on.
    const sizeAt = body + (bytes[body] === 1 ? 88 : 76);
    if (sizeAt + 8 > bytes.length) return undefined;
    const width = view.getUint32(sizeAt) >>> 16;
    const height = view.getUint32(sizeAt + 4) >>> 16;
    // An audio track's header declares no size; the video track's comes later.
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

/**
 * Every step still under `public/img/learn`, with its size and recording.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function scanLearnMedia(packageRoot: string): LearnMedia {
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

    const real = (ext: string, check: (bytes: Uint8Array) => boolean) => {
      const path = join(root, `${key}.${ext}`);
      return existsSync(path) && check(readFileSync(path));
    };
    // A Git LFS pointer is a short text file, not a video.
    const isVideo = (bytes: Uint8Array) =>
      bytes.length > 1024 &&
      !String.fromCharCode(...bytes.subarray(0, 7)).startsWith("version");
    const mp4 = real("mp4", isVideo);
    const webm = real("webm", isVideo);
    const posterPath = join(root, `${key}.poster.webp`);
    const poster = existsSync(posterPath)
      ? webpSize(readFileSync(posterPath))
      : undefined;

    media[key] = {
      ...size,
      ...(poster && { poster }),
      ...((mp4 || webm) && {
        clip: {
          size:
            (mp4 && mp4Size(readFileSync(join(root, `${key}.mp4`)))) || size,
          webm,
          mp4,
        },
      }),
    };
  }
  return media;
}

/** Hands the scan to the app as `__LEARN_MEDIA__`, and rescans when a step's media changes in dev. */
export function learnMediaPlugin(packageRoot: string): Plugin {
  const inventory = () => JSON.stringify(scanLearnMedia(packageRoot));
  const mediaRoot = `${normalizePath(resolve(packageRoot, learnDir))}/`;
  return {
    name: "zotlit:learn-media",
    config() {
      return { define: { __LEARN_MEDIA__: inventory() } };
    },
    configureServer(server) {
      async function refresh(path: string) {
        if (!normalizePath(path).startsWith(mediaRoot)) return;
        if (server.config.define?.__LEARN_MEDIA__ !== inventory()) {
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
