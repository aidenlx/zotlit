import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";

import { copyAttachments } from "./copy-attachments";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zotlit-copy-attachments-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

layer(NodeFileSystem.layer)("copyAttachments", (it) => {
  it.effect("copies once and skips when destination size and mtime match", () =>
    Effect.gen(function* () {
      const source = join(dir, "source.png");
      const dest = join(dir, "dest.png");
      yield* Effect.promise(() => writeFile(source, "image"));
      const mtime = 1_704_067_200;
      yield* Effect.promise(() => utimes(source, mtime, mtime));

      expect(
        yield* copyAttachments([
          { source: { kind: "path", path: source }, dest },
        ]),
      ).toEqual({
        copied: 1,
        skipped: 0,
        missing: 0,
      });
      expect(yield* Effect.promise(() => readFile(dest, "utf8"))).toBe("image");

      const [sourceStat, destStat] = yield* Effect.promise(() =>
        Promise.all([stat(source), stat(dest)]),
      );
      expect(destStat.size).toBe(sourceStat.size);
      expect(destStat.mtimeMs).toBe(sourceStat.mtimeMs);

      expect(
        yield* copyAttachments([
          { source: { kind: "path", path: source }, dest },
        ]),
      ).toEqual({
        copied: 0,
        skipped: 1,
        missing: 0,
      });
    }),
  );

  it.effect(
    "skips a source whose mtime has a sub-millisecond part once it is copied",
    () =>
      Effect.gen(function* () {
        const source = join(dir, "source.png");
        const dest = join(dir, "dest.png");
        yield* Effect.promise(() => writeFile(source, "image"));
        // Half a millisecond past 2024-01-01T00:00:00Z: a file the system
        // stamps, not one Zotero sync stamped to whole milliseconds.
        const mtime = 1_704_067_200.0005;
        yield* Effect.promise(() => utimes(source, mtime, mtime));
        const item = { source: { kind: "path", path: source }, dest } as const;

        yield* copyAttachments([item]);
        expect(yield* copyAttachments([item])).toEqual({
          copied: 0,
          skipped: 1,
          missing: 0,
        });
      }),
  );

  it.effect(
    "skips a missing source without aborting the rest of the batch",
    () =>
      Effect.gen(function* () {
        const present = join(dir, "present.png");
        const presentDest = join(dir, "present-dest.png");
        yield* Effect.promise(() => writeFile(present, "image"));

        expect(
          yield* copyAttachments([
            {
              source: { kind: "path", path: join(dir, "missing.png") },
              dest: join(dir, "missing-dest.png"),
            },
            { source: { kind: "path", path: present }, dest: presentDest },
          ]),
        ).toEqual({ copied: 1, skipped: 0, missing: 1 });
        expect(yield* Effect.promise(() => readFile(presentDest, "utf8"))).toBe(
          "image",
        );
      }),
  );

  it.effect(
    "copies a descriptor source, stamping the destination from the open file",
    () =>
      Effect.gen(function* () {
        const source = join(dir, "source.png");
        const dest = join(dir, "dest.png");
        yield* Effect.promise(() => writeFile(source, "image"));
        // Seconds since the epoch (2024-01-01T00:00:00Z), the form `utimes`
        // takes alongside a `Date`.
        const mtimeSeconds = 1_704_067_200;
        yield* Effect.promise(() => utimes(source, mtimeSeconds, mtimeSeconds));
        const handle = yield* (yield* FileSystem.FileSystem).open(source);

        expect(
          yield* copyAttachments([
            { source: { kind: "handle", handle }, dest },
          ]),
        ).toEqual({ copied: 1, skipped: 0, missing: 0 });
        expect(yield* Effect.promise(() => readFile(dest, "utf8"))).toBe(
          "image",
        );
        expect((yield* Effect.promise(() => stat(dest))).mtimeMs).toBe(
          mtimeSeconds * 1000,
        );
      }).pipe(Effect.scoped),
  );

  it.effect(
    "copies every byte of a descriptor source larger than one read",
    () =>
      Effect.gen(function* () {
        const source = join(dir, "source.pdf");
        const dest = join(dir, "dest.pdf");
        const bytes = Buffer.alloc(200 * 1024, "zotlit");
        yield* Effect.promise(() => writeFile(source, bytes));
        const handle = yield* (yield* FileSystem.FileSystem).open(source);

        yield* copyAttachments([{ source: { kind: "handle", handle }, dest }]);
        expect(
          (yield* Effect.promise(() => readFile(dest))).equals(bytes),
        ).toBe(true);
      }).pipe(Effect.scoped),
  );
});
