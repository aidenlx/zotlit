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

import { CSL_STAGING_EXT, cslStoreDirectory } from "./csl";
import { reapCslStore } from "./reap-temps";

let parent: string;
let store: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "zotlit-reap-csl-"));
  store = cslStoreDirectory(parent);
  await mkdir(store, { recursive: true });
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** The test's now, in seconds since the epoch: every entry ages against it. */
const NOW = 1_000_000_000;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** A store entry stamped `seconds` before {@link NOW}, with the Clock at NOW. */
const entry = (name: string, seconds: number) =>
  Effect.gen(function* () {
    const path = join(store, name);
    yield* Effect.promise(() => writeFile(path, "<style/>"));
    yield* Effect.promise(() => utimes(path, NOW - seconds, NOW - seconds));
    yield* TestClock.setTime(NOW * 1000);
    return name;
  });

const names = Effect.promise(async () => (await readdir(store)).sort());

layer(NodeFileSystem.layer)("reapCslStore", (it) => {
  it.effect(
    "evicts a style once it ages out, keeping one still in its window",
    () =>
      Effect.gen(function* () {
        yield* entry("old.csl", 31 * DAY);
        yield* entry("fresh.csl", 29 * DAY);
        yield* reapCslStore({ parent });
        expect(yield* names).toEqual(["fresh.csl"]);
      }),
  );

  it.effect("evicts an abandoned staged file on a far shorter clock", () =>
    Effect.gen(function* () {
      yield* entry(`.abandoned${CSL_STAGING_EXT}`, 2 * HOUR);
      yield* entry(`.writing${CSL_STAGING_EXT}`, 0);
      // Same age as the abandoned staged file, but a style's clock is far longer.
      yield* entry("kept.csl", 2 * HOUR);
      yield* reapCslStore({ parent });
      expect(yield* names).toEqual([`.writing${CSL_STAGING_EXT}`, "kept.csl"]);
    }),
  );

  it.effect(
    "ages an unrecognized entry as a style, since ZotLit owns the store",
    () =>
      Effect.gen(function* () {
        yield* entry("stray", 31 * DAY);
        yield* entry("recent-stray", HOUR);
        yield* reapCslStore({ parent });
        expect(yield* names).toEqual(["recent-stray"]);
      }),
  );

  it.effect("ages a kept style out once the Clock moves past its window", () =>
    Effect.gen(function* () {
      yield* entry("style.csl", 29 * DAY);
      yield* reapCslStore({ parent });
      expect(yield* names).toEqual(["style.csl"]);
      yield* TestClock.adjust("2 days");
      yield* reapCslStore({ parent });
      expect(yield* names).toEqual([]);
    }),
  );

  it.effect("settles quietly before the store has ever been written", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => rm(store, { recursive: true }));
      yield* reapCslStore({ parent });
    }),
  );

  it.effect("leaves every entry in place when interrupted before it runs", () =>
    Effect.gen(function* () {
      yield* entry("old.csl", 31 * DAY);
      const reap = yield* Effect.forkChild(reapCslStore({ parent }), {
        startImmediately: false,
      });
      yield* Fiber.interrupt(reap);
      expect(yield* names).toEqual(["old.csl"]);
    }),
  );
});
