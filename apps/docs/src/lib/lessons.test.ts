import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { mp4Size, webpSize } from "./learn-media";

import { learnSchema } from "#content-config";

const ascii = (text: string) => new TextEncoder().encode(text);

const learnDir = resolve(import.meta.dirname, "../../content/learn");
const lessons = globSync("*.mdx", { cwd: learnDir }).map((file) => {
  const source = readFileSync(join(learnDir, file), "utf8");
  const { data, content } = frontmatter(source);
  return { file, data: v.parse(learnSchema, data), body: content };
});

/** The body between `<Step n={k}>` and its `</Step>`, for each step in order. */
function stepBlocks(body: string) {
  return [...body.matchAll(/<Step n=\{(\d+)\}>([\s\S]*?)<\/Step>/g)].map(
    ([, n, inner]) => ({ n: Number(n), inner: inner! }),
  );
}

describe("the lessons", () => {
  it("number the course 1 to N with no gap", () => {
    expect(
      lessons.map(({ data }) => data.lesson).toSorted((a, b) => a - b),
    ).toEqual(lessons.map((_, index) => index + 1));
  });

  it.each(lessons)(
    "$file has one <Step> per frontmatter step, in order",
    ({ data, body }) => {
      expect(stepBlocks(body).map(({ n }) => n)).toEqual(
        data.steps.map((_, index) => index + 1),
      );
    },
  );

  it.each(lessons)("$file gives every step one check line", ({ body }) => {
    for (const { n, inner } of stepBlocks(body)) {
      expect([...inner.matchAll(/<Check>/g)].length, `step ${n}`).toBe(1);
    }
  });
});

describe("the media scan", () => {
  it("reads a lossy WebP's size", () => {
    const header = new Uint8Array(30);
    header.set(ascii("RIFF"), 0);
    header.set(ascii("WEBPVP8 "), 8);
    const view = new DataView(header.buffer);
    view.setUint16(26, 3456, true);
    view.setUint16(28, 2296, true);
    expect(webpSize(header)).toEqual({ width: 3456, height: 2296 });
  });

  it("reads nothing from a Git LFS pointer", () => {
    const pointer = ascii(
      "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n",
    );
    expect(webpSize(pointer)).toBeUndefined();
    expect(mp4Size(pointer)).toBeUndefined();
  });

  it("reads the video track's size from an MP4 track header", () => {
    // A version 0 `tkhd` box: 4 bytes of version and flags, 72 bytes of
    // times, ids, volume and matrix, then width and height in 16.16.
    const box = new Uint8Array(8 + 4 + 76 + 8);
    box.set(ascii("tkhd"), 4);
    const view = new DataView(box.buffer);
    view.setUint32(8 + 76, 1440 << 16);
    view.setUint32(8 + 80, 860 << 16);
    expect(mp4Size(box)).toEqual({ width: 1440, height: 860 });
  });
});
