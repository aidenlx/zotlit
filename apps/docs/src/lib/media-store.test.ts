import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { mediaStorePlugin, scanVideos, uploadMissing } from "./media-store";
import type { SignedFetch } from "./media-store";

// The fixture's two videos and the keys their bytes give: the first 8 hex
// digits of each file's SHA-256 (`shasum -a 256`), worked out by hand.
const lessonBytes = Buffer.alloc(2048, "a");
const landingBytes = Buffer.alloc(3000, "b");
const lessonKey = "learn/demo/step-1.b2a3a502.mp4";
const landingKey = "landing/find.eb8b4d8d.mp4";
const origin = "https://media.example";
const objectUrl = (key: string) =>
  `https://acct.r2.cloudflarestorage.com/zotlit-docs-media/${key}`;

let packageRoot: string;

beforeEach(async () => {
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  await mkdir(join(workspaceRoot, ".scratch"), { recursive: true });
  packageRoot = await mkdtemp(join(workspaceRoot, ".scratch/media-store-"));
  const img = join(packageRoot, "public/img");
  await mkdir(join(img, "learn/demo"), { recursive: true });
  await mkdir(join(img, "landing"), { recursive: true });
  await writeFile(join(img, "learn/demo/step-1.mp4"), lessonBytes);
  await writeFile(join(img, "learn/demo/step-1.webp"), "still");
  await writeFile(
    join(img, "learn/demo/step-2.mp4"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n",
  );
  await writeFile(join(img, "landing/find.mp4"), landingBytes);
});
afterEach(() => rm(packageRoot, { recursive: true, force: true }));

describe("scanVideos", () => {
  it("keys each video by its path and content hash, and leaves out a Git LFS pointer", () => {
    expect(scanVideos(packageRoot)).toEqual([
      {
        path: "/img/landing/find.mp4",
        file: join(packageRoot, "public/img/landing/find.mp4"),
        key: landingKey,
      },
      {
        path: "/img/learn/demo/step-1.mp4",
        file: join(packageRoot, "public/img/learn/demo/step-1.mp4"),
        key: lessonKey,
      },
    ]);
  });
});

/** R2's S3 API as the uploader sees it: HEAD answers what the bucket holds, PUT stores. */
function fakeBucket(held: string[] = [], headStatus?: number) {
  const objects = new Map<string, { body: Buffer; headers: Headers }>(
    held.map((key) => [
      objectUrl(key),
      { body: Buffer.alloc(0), headers: new Headers() },
    ]),
  );
  const requests: string[] = [];
  const fetch: SignedFetch = async (url, init) => {
    requests.push(`${init.method} ${url}`);
    if (init.method === "HEAD") {
      const status = headStatus ?? (objects.has(url) ? 200 : 404);
      return new Response(null, { status });
    }
    objects.set(url, {
      body: Buffer.from(init.body as Uint8Array),
      headers: new Headers(init.headers),
    });
    return new Response(null, { status: 200 });
  };
  return { fetch, objects, requests };
}

describe("uploadMissing", () => {
  const send = (bucket: ReturnType<typeof fakeBucket>, dryRun = false) =>
    uploadMissing(scanVideos(packageRoot), {
      fetch: bucket.fetch,
      accountId: "acct",
      dryRun,
    });

  it("uploads the keys the bucket lacks with their type and cache header, and skips the ones it holds", async () => {
    const bucket = fakeBucket([landingKey]);
    expect(await send(bucket)).toEqual([
      { key: landingKey, state: "present" },
      { key: lessonKey, state: "uploaded" },
    ]);
    expect(bucket.requests).toEqual([
      `HEAD ${objectUrl(landingKey)}`,
      `HEAD ${objectUrl(lessonKey)}`,
      `PUT ${objectUrl(lessonKey)}`,
    ]);
    const put = bucket.objects.get(objectUrl(lessonKey))!;
    expect(put.body.equals(lessonBytes)).toBe(true);
    expect(put.headers.get("content-type")).toBe("video/mp4");
    expect(put.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("uploads nothing on a second run", async () => {
    const bucket = fakeBucket();
    await send(bucket);
    bucket.requests.length = 0;
    expect(await send(bucket)).toEqual([
      { key: landingKey, state: "present" },
      { key: lessonKey, state: "present" },
    ]);
    expect(bucket.requests).toEqual([
      `HEAD ${objectUrl(landingKey)}`,
      `HEAD ${objectUrl(lessonKey)}`,
    ]);
  });

  it("sends no PUT in a dry run", async () => {
    const bucket = fakeBucket();
    expect(await send(bucket, true)).toEqual([
      { key: landingKey, state: "missing" },
      { key: lessonKey, state: "missing" },
    ]);
    expect(bucket.objects.size).toBe(0);
  });

  it("fails on a HEAD that answers neither 200 nor 404", async () => {
    await expect(send(fakeBucket([], 403))).rejects.toThrow(
      `HEAD ${landingKey} answered 403.`,
    );
  });
});

describe("mediaStorePlugin", () => {
  /** A production build of an entry that exports the define, and its output folder. */
  async function buildSite() {
    await writeFile(
      join(packageRoot, "entry.js"),
      "export default __MEDIA_URLS__;\n",
    );
    const outDir = join(packageRoot, "dist");
    await build({
      root: packageRoot,
      configFile: false,
      logLevel: "silent",
      plugins: [mediaStorePlugin(packageRoot)],
      build: {
        outDir,
        minify: false,
        lib: { entry: "entry.js", formats: ["es"], fileName: "entry" },
      },
    });
    const urls = (
      (await import(pathToFileURL(join(outDir, "entry.js")).href)) as {
        default: Record<string, string>;
      }
    ).default;
    return { urls, outDir };
  }

  it("points each video at its media-store key and drops it from the output when the origin is set", async () => {
    await writeFile(join(packageRoot, ".env"), `VITE_MEDIA_ORIGIN=${origin}\n`);
    const { urls, outDir } = await buildSite();
    expect(urls).toEqual({
      "/img/landing/find.mp4": `${origin}/${landingKey}`,
      "/img/learn/demo/step-1.mp4": `${origin}/${lessonKey}`,
    });
    // The keys the uploader sends are the ones the pages point at.
    const bucket = fakeBucket();
    await uploadMissing(scanVideos(packageRoot), {
      fetch: bucket.fetch,
      accountId: "acct",
      dryRun: false,
    });
    expect(
      Object.values(urls).map((url) => objectUrl(url.slice(origin.length + 1))),
    ).toEqual([...bucket.objects.keys()]);
    expect(existsSync(join(outDir, "img/learn/demo/step-1.mp4"))).toBe(false);
    expect(existsSync(join(outDir, "img/landing/find.mp4"))).toBe(false);
    expect(
      await readFile(join(outDir, "img/learn/demo/step-1.webp"), "utf8"),
    ).toBe("still");
  });

  it("keeps the site paths and the videos without the origin", async () => {
    const { urls, outDir } = await buildSite();
    expect(urls).toEqual({});
    expect(existsSync(join(outDir, "img/learn/demo/step-1.mp4"))).toBe(true);
    expect(existsSync(join(outDir, "img/landing/find.mp4"))).toBe(true);
  });
});
