// The recordings' video files and where a build serves them from.
//
// The clips live in `public/img/learn/<media>/step-<n>.mp4` and
// `public/img/landing/<case>.mp4` (Git LFS), where the recording
// recipes write them. A deployed build plays them from the media store, the
// R2 bucket `zotlit-docs-media` on `VITE_MEDIA_ORIGIN`: each file's object key
// is its path under `public/img` with the first 8 hex digits of its SHA-256
// before the extension, so a new cut gets a new URL and every object is
// immutable. `scripts/upload-media.ts` uploads the keys the bucket lacks. A
// build without the origin, and the dev server, serve the files from the site
// itself under `/img/...`. The stills stay on the site in every build.
//
// This module runs in Node: `mediaStorePlugin` hands the URLs to the app as
// the `__MEDIA_URLS__` define and drops the videos from the client output, and
// the upload script reads the same list.

import { createHash } from "node:crypto";
import { globSync, readFileSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { loadEnv, normalizePath } from "vite";
import type { Plugin } from "vite";

/** The R2 bucket behind the media origin; both docs lines share it. */
export const mediaBucket = "zotlit-docs-media";

/** Every object's key carries its content hash, so its bytes never change. */
export const mediaCacheControl = "public, max-age=31536000, immutable";

/** Every clip is an H.264 MP4. */
export const mediaContentType = "video/mp4";

/** One video file of a recording. */
export interface StoredVideo {
  /** The site path that serves the file without the media store, such as `/img/learn/<media>/step-1.mp4`. */
  path: string;
  /** The file on disk. */
  file: string;
  /** The object key in the media store, such as `learn/<media>/step-1.<hash>.mp4`. */
  key: string;
}

const imgDir = "public/img";
const videoPatterns = ["learn/*/step-*.mp4", "landing/*.mp4"];

/** Whether `bytes` are a video rather than the short text of a Git LFS pointer. */
export function isVideoBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 1024 &&
    !String.fromCharCode(...bytes.subarray(0, 7)).startsWith("version")
  );
}

/**
 * Every lesson and landing video on disk, sorted by path; a file that is
 * still a Git LFS pointer is left out.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function scanVideos(packageRoot: string): StoredVideo[] {
  const root = resolve(packageRoot, imgDir);
  return globSync(videoPatterns, { cwd: root })
    .map(normalizePath)
    .toSorted()
    .flatMap((rel): StoredVideo[] => {
      const file = join(root, rel);
      const bytes = readFileSync(file);
      if (!isVideoBytes(bytes)) return [];
      const ext = extname(rel);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      return [
        {
          path: `/img/${rel}`,
          file,
          key: `${rel.slice(0, -ext.length)}.${hash}${ext}`,
        },
      ];
    });
}

/** Each video's site path mapped to its URL on `origin`. */
export function mediaUrls(
  videos: readonly StoredVideo[],
  origin: string,
): Record<string, string> {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return Object.fromEntries(videos.map((v) => [v.path, `${base}/${v.key}`]));
}

/**
 * Hands the media-store URLs to the app as `__MEDIA_URLS__` in a build with
 * `VITE_MEDIA_ORIGIN` set, and removes those videos from the client output so
 * the Worker's assets carry the stills alone. The dev server and a build
 * without the origin get an empty map, and the player keeps the `/img/...`
 * paths.
 */
export function mediaStorePlugin(packageRoot: string): Plugin {
  let videos: StoredVideo[] = [];
  return {
    name: "zotlit:media-store",
    config(_config, { command, mode }) {
      const origin =
        command === "build"
          ? loadEnv(mode, packageRoot, "VITE_MEDIA_ORIGIN").VITE_MEDIA_ORIGIN
          : undefined;
      videos = origin ? scanVideos(packageRoot) : [];
      const urls = origin ? mediaUrls(videos, origin) : {};
      return { define: { __MEDIA_URLS__: JSON.stringify(urls) } };
    },
    // Vite copies `public/` into the client output before it writes the
    // bundle, so the copies are on disk by now.
    writeBundle(options) {
      if (this.environment.name !== "client" || !options.dir) return;
      for (const video of videos) {
        rmSync(join(options.dir, video.path), { force: true });
      }
    },
  };
}
