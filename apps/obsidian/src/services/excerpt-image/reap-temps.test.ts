import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";

import { reapExcerptTemps } from "./reap-temps";
import { excerptTempDirectory } from "./temp-store";

let parent: string;
let directory: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "zotlit-reap-excerpt-"));
  directory = excerptTempDirectory(parent);
  await mkdir(directory, { recursive: true });
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** The test's now, in seconds since the epoch: every entry ages against it. */
const NOW = 1_000_000_000;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** An entry stamped `seconds` before {@link NOW}, with the Clock at NOW. */
const entry = (name: string, seconds: number) =>
  Effect.gen(function* () {
    const path = join(directory, name);
    yield* Effect.promise(() => writeFile(path, "png"));
    yield* Effect.promise(() => utimes(path, NOW - seconds, NOW - seconds));
    yield* TestClock.setTime(NOW * 1000);
    return name;
  });

const names = Effect.promise(async () => (await readdir(directory)).sort());

layer(NodeFileSystem.layer)("reapExcerptTemps", (it) => {
  it.effect("evicts a PNG unused for seven days, keeping a recent one", () =>
    Effect.gen(function* () {
      yield* entry("old.png", 8 * DAY);
      yield* entry("recent.png", 6 * DAY);
      yield* reapExcerptTemps({ parent });
      expect(yield* names).toEqual(["recent.png"]);
    }),
  );

  it.effect("evicts an abandoned write after an hour", () =>
    Effect.gen(function* () {
      yield* entry(".abandoned.part", 2 * HOUR);
      yield* entry(".writing.part", 0);
      yield* entry("kept.png", 2 * HOUR);
      yield* reapExcerptTemps({ parent });
      expect(yield* names).toEqual([".writing.part", "kept.png"]);
    }),
  );

  it.effect("ages a kept PNG out once the Clock moves past its window", () =>
    Effect.gen(function* () {
      yield* entry("image.png", 6 * DAY);
      yield* reapExcerptTemps({ parent });
      expect(yield* names).toEqual(["image.png"]);
      yield* TestClock.adjust("2 days");
      yield* reapExcerptTemps({ parent });
      expect(yield* names).toEqual([]);
    }),
  );

  it.effect("settles quietly before anything was published", () =>
    reapExcerptTemps({ parent: join(parent, "missing") }),
  );

  it.effect("leaves every entry in place when interrupted before it runs", () =>
    Effect.gen(function* () {
      yield* entry("old.png", 8 * DAY);
      const reap = yield* Effect.forkChild(reapExcerptTemps({ parent }), {
        startImmediately: false,
      });
      yield* Fiber.interrupt(reap);
      expect(yield* names).toEqual(["old.png"]);
    }),
  );
});
