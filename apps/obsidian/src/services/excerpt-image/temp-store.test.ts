import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import { Clock, Duration, Effect } from "effect";
import { mkdtemp, readFile, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { bluePng, redPng } from "./__fixtures__/png";
import { reapExcerptTemps } from "./reap-temps";
import { excerptTempDirectory, publishExcerptPng } from "./temp-store";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("publishes a complete PNG once for concurrent uses of one fingerprint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zotlit-excerpt-test-"));
  directories.push(directory);
  const paths = await Promise.all(
    Array.from({ length: 8 }, () =>
      publishExcerptPng("a".repeat(64), redPng, directory),
    ),
  );
  expect(new Set(paths).size).toBe(1);
  expect(await readFile(paths[0]!)).toEqual(Buffer.from(redPng));
  expect(await readdir(directory)).toEqual([basename(paths[0]!)]);
});

// The publish restamps with the wall clock, so the reap reads the live Clock.
effectIt.live(
  "keeps a reused PNG and reaps one unused for more than seven days",
  () =>
    Effect.gen(function* () {
      const parent = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "zotlit-excerpt-test-")),
      );
      directories.push(parent);
      const directory = excerptTempDirectory(parent);
      const publish = (fingerprint: string) =>
        Effect.promise(() => publishExcerptPng(fingerprint, redPng, directory));
      const recent = yield* publish("a".repeat(64));
      const old = yield* publish("b".repeat(64));
      const now = yield* Clock.currentTimeMillis;
      const time = (now - Duration.toMillis(Duration.days(8))) / 1000;
      yield* Effect.promise(() =>
        Promise.all([utimes(recent, time, time), utimes(old, time, time)]),
      );
      yield* publish("a".repeat(64));
      expect(
        (yield* Effect.promise(() => stat(recent))).mtimeMs,
      ).toBeGreaterThan(time * 1000);
      yield* reapExcerptTemps({ parent });
      expect(yield* Effect.promise(() => readdir(directory))).toEqual([
        basename(recent),
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it("publishes refreshed pixels for the same Annotation identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zotlit-excerpt-test-"));
  directories.push(directory);
  const identity = "a".repeat(64);
  const original = await publishExcerptPng(identity, redPng, directory);
  const refreshed = await publishExcerptPng(identity, bluePng, directory);
  expect(refreshed).not.toBe(original);
  expect(await readFile(original)).toEqual(Buffer.from(redPng));
  expect(await readFile(refreshed)).toEqual(Buffer.from(bluePng));
  expect(await publishExcerptPng(identity, bluePng, directory)).toBe(refreshed);
});
