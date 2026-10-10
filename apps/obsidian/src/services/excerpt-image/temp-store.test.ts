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

it("keeps a reused PNG and reaps one unused for more than seven days", async () => {
  const parent = await mkdtemp(join(tmpdir(), "zotlit-excerpt-test-"));
  directories.push(parent);
  const directory = excerptTempDirectory(parent);
  const recent = await publishExcerptPng("a".repeat(64), redPng, directory);
  const old = await publishExcerptPng("b".repeat(64), redPng, directory);
  const time =
    Temporal.Now.instant().subtract({ hours: 8 * 24 }).epochMilliseconds / 1000;
  await Promise.all([utimes(recent, time, time), utimes(old, time, time)]);
  await publishExcerptPng("a".repeat(64), redPng, directory);
  expect((await stat(recent)).mtimeMs).toBeGreaterThan(time * 1000);
  await reapExcerptTemps({ parent });
  expect(await readdir(directory)).toEqual([basename(recent)]);
  await expect(
    reapExcerptTemps({ parent: join(parent, "missing") }),
  ).resolves.toBeUndefined();
});

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
