// The recordings' video files and where a build serves them from.
//
// The clips live in `public/img/learn/<media>/step-<n>.mp4` and
// `public/img/landing/<case>.mp4` (Git LFS), where the recording recipes
// write them. A deployed build plays them from the media store, the R2 bucket
// `zotlit-docs-media` on `VITE_MEDIA_ORIGIN`: each file's object key is its
// path under `public/img` with the first 8 hex digits of its SHA-256 before
// the extension, so a new cut gets a new URL and every object is immutable.
// `uploadMissing` (run by `scripts/upload-media.ts`) sends the keys the
// bucket lacks. A build without the origin, and the dev server, serve the
// files from the site itself under `/img/...`. The stills stay on the site in
// every build.
//
// This module runs in Node: `mediaStorePlugin` hands the URLs to the app as
// the `__MEDIA_URLS__` define and drops the videos from the client output,
// `scanLearnMedia` reads the lesson clips from the same scan, and the upload
// script sends the same keys.

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

/** A picture's pixel size. */
export interface MediaSize {
  width: number;
  height: number;
}

export interface StoredVideo {
  /** The site path that serves the file without the media store, such as `/img/learn/<media>/step-1.mp4`. */
  path: string;
  file: string;
  /** The object key in the media store, such as `learn/<media>/step-1.<hash>.mp4`. */
  key: string;
  /** The display size the MP4 header declares, when it declares one. */
  size?: MediaSize;
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
 * Every lesson and landing video on disk, sorted by path, each read once; a
 * file that is still a Git LFS pointer is left out.
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
      const size = mp4Size(bytes);
      return [
        {
          path: `/img/${rel}`,
          file,
          key: `${rel.slice(0, -ext.length)}.${hash}${ext}`,
          ...(size && { size }),
        },
      ];
    });
}

/** Each video's site path mapped to its URL on `origin`, which has no trailing slash. */
export function mediaUrls(
  videos: readonly StoredVideo[],
  origin: string,
): Record<string, string> {
  return Object.fromEntries(videos.map((v) => [v.path, `${origin}/${v.key}`]));
}

/** A `fetch` that signs its request for R2's S3 API, such as `AwsClient.fetch`. */
export type SignedFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What an upload run did with one key. */
export interface UploadResult {
  key: string;
  /** `missing` is a key a dry run would upload. */
  state: "present" | "uploaded" | "missing";
}

/**
 * Upload each of `videos` the media store lacks, through R2's S3 API: a HEAD
 * per key, then a PUT with the content type and the immutable cache header
 * for each key that answers 404. A dry run sends the HEADs alone.
 * @throws when a HEAD answers other than 200 or 404, or a PUT fails.
 */
export async function uploadMissing(
  videos: readonly StoredVideo[],
  {
    fetch,
    accountId,
    dryRun,
  }: { fetch: SignedFetch; accountId: string; dryRun: boolean },
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const { key, file } of videos) {
    const url = `https://${accountId}.r2.cloudflarestorage.com/${mediaBucket}/${key}`;
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      results.push({ key, state: "present" });
      continue;
    }
    if (head.status !== 404) {
      throw new Error(`HEAD ${key} answered ${head.status}.`);
    }
    if (dryRun) {
      results.push({ key, state: "missing" });
      continue;
    }
    const put = await fetch(url, {
      method: "PUT",
      body: readFileSync(file),
      headers: {
        "Content-Type": mediaContentType,
        "Cache-Control": mediaCacheControl,
      },
    });
    if (!put.ok) {
      throw new Error(`PUT ${key} answered ${put.status}: ${await put.text()}`);
    }
    results.push({ key, state: "uploaded" });
  }
  return results;
}

/**
 * Hands the media-store URLs to the app as `__MEDIA_URLS__` in a build with
 * `VITE_MEDIA_ORIGIN` set, and removes those videos from the client output so
 * the Worker's assets carry the stills alone. The dev server and a build
 * without the origin get an empty map, and the player keeps the `/img/...`
 * paths.
 * @param videos the scan to use; `vite.config.ts` shares one with `learnMediaPlugin`.
 */
export function mediaStorePlugin(
  packageRoot: string,
  videos: () => readonly StoredVideo[] = () => scanVideos(packageRoot),
): Plugin {
  let stored: readonly StoredVideo[] = [];
  return {
    name: "zotlit:media-store",
    config(_config, { command, mode }) {
      const origin =
        command === "build"
          ? loadEnv(mode, packageRoot, "VITE_MEDIA_ORIGIN").VITE_MEDIA_ORIGIN
          : undefined;
      stored = origin ? videos() : [];
      const urls = origin ? mediaUrls(stored, origin) : {};
      return { define: { __MEDIA_URLS__: JSON.stringify(urls) } };
    },
    // Vite copies `public/` into the client output before it writes the
    // bundle, so the copies are on disk by now.
    writeBundle(options) {
      if (this.environment.name !== "client") return;
      for (const video of stored) rmSync(join(options.dir!, video.path));
    },
  };
}
