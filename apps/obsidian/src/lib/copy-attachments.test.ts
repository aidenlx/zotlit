import {
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyAttachments } from "./copy-attachments";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zotlit-copy-attachments-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("copyAttachments", () => {
  it("copies once and skips when destination size and mtime match", async () => {
    const source = join(dir, "source.png");
    const dest = join(dir, "dest.png");
    await writeFile(source, "image");
    const mtime = new Date("2024-01-01T00:00:00.000Z");
    await utimes(source, mtime, mtime);

    await expect(
      copyAttachments([{ source: { kind: "path", path: source }, dest }]),
    ).resolves.toEqual({
      copied: 1,
      skipped: 0,
      missing: 0,
    });
    expect(await readFile(dest, "utf8")).toBe("image");

    const [sourceStat, destStat] = await Promise.all([
      stat(source),
      stat(dest),
    ]);
    expect(destStat.size).toBe(sourceStat.size);
    expect(destStat.mtimeMs).toBe(sourceStat.mtimeMs);

    await expect(
      copyAttachments([{ source: { kind: "path", path: source }, dest }]),
    ).resolves.toEqual({
      copied: 0,
      skipped: 1,
      missing: 0,
    });
  });

  it("skips a missing source without aborting the rest of the batch", async () => {
    const present = join(dir, "present.png");
    const presentDest = join(dir, "present-dest.png");
    await writeFile(present, "image");

    await expect(
      copyAttachments([
        {
          source: { kind: "path", path: join(dir, "missing.png") },
          dest: join(dir, "missing-dest.png"),
        },
        { source: { kind: "path", path: present }, dest: presentDest },
      ]),
    ).resolves.toEqual({ copied: 1, skipped: 0, missing: 1 });
    expect(await readFile(presentDest, "utf8")).toBe("image");
  });

  it("copies a descriptor source, stamping the destination from the open file", async () => {
    const source = join(dir, "source.png");
    const dest = join(dir, "dest.png");
    await writeFile(source, "image");
    // Seconds since the epoch (2024-01-01T00:00:00Z), the form `utimes` takes
    // alongside a `Date`.
    const mtimeSeconds = 1_704_067_200;
    await utimes(source, mtimeSeconds, mtimeSeconds);
    await using handle = await open(source, "r");

    await expect(
      copyAttachments([{ source: { kind: "handle", handle }, dest }]),
    ).resolves.toEqual({ copied: 1, skipped: 0, missing: 0 });
    expect(await readFile(dest, "utf8")).toBe("image");
    expect((await stat(dest)).mtimeMs).toBe(mtimeSeconds * 1000);
  });
});
