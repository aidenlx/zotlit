import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as v from "valibot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mp4Size, scanLearnMedia, webpSize } from "./learn-media";

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

  it("name a different chore each", () => {
    const chores = lessons.map(({ data }) => data.chore);
    expect(new Set(chores).size).toBe(chores.length);
  });

  it.each(lessons)(
    "$file writes each chore of today to follow “Today you”",
    ({ data }) => {
      for (const chore of data.today) {
        expect(chore, chore).toMatch(/^[a-z]/);
        expect(chore, chore).not.toMatch(/[.!?]$/);
      }
    },
  );
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

  describe("of a folder", () => {
    let packageRoot: string;
    const folder = () => join(packageRoot, "public/img/learn/lesson");
    /** A lossy WebP header of the given size. */
    const webp = (width: number, height: number) => {
      const header = new Uint8Array(30);
      header.set(ascii("RIFF"), 0);
      header.set(ascii("WEBPVP8 "), 8);
      const view = new DataView(header.buffer);
      view.setUint16(26, width, true);
      view.setUint16(28, height, true);
      return header;
    };

    beforeEach(() => {
      packageRoot = mkdtempSync(join(tmpdir(), "learn-media-"));
      mkdirSync(folder(), { recursive: true });
      writeFileSync(join(folder(), "step-1.webp"), webp(3456, 2296));
    });
    afterEach(() => rmSync(packageRoot, { recursive: true, force: true }));

    it("reads a step with no poster as its still alone", () => {
      expect(scanLearnMedia(packageRoot)).toEqual({
        "lesson/step-1": { width: 3456, height: 2296 },
      });
    });

    it("gives a step its poster's size, and no step to the poster itself", () => {
      writeFileSync(join(folder(), "step-1.poster.webp"), webp(1440, 860));
      expect(scanLearnMedia(packageRoot)).toEqual({
        "lesson/step-1": {
          width: 3456,
          height: 2296,
          poster: { width: 1440, height: 860 },
        },
      });
    });

    it("leaves out a poster that is still a Git LFS pointer", () => {
      writeFileSync(
        join(folder(), "step-1.poster.webp"),
        "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n",
      );
      expect(scanLearnMedia(packageRoot)["lesson/step-1"]).not.toHaveProperty(
        "poster",
      );
    });
  });
});
