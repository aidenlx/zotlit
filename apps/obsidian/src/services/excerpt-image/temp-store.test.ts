import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  PlatformError,
} from "effect";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect } from "vitest";

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

/** A fresh directory under the system temp directory, removed after the case. */
const testDirectory = Effect.promise(async () => {
  const directory = await mkdtemp(join(tmpdir(), "zotlit-excerpt-test-"));
  directories.push(directory);
  return directory;
});

effectIt.effect(
  "publishes a complete PNG once for concurrent uses of one fingerprint",
  () =>
    Effect.gen(function* () {
      const directory = yield* testDirectory;
      const paths = yield* Effect.all(
        Array.from({ length: 8 }, () =>
          publishExcerptPng("a".repeat(64), redPng, directory),
        ),
        { concurrency: "unbounded" },
      );
      expect(new Set(paths).size).toBe(1);
      expect(yield* Effect.promise(() => readFile(paths[0]!))).toEqual(
        Buffer.from(redPng),
      );
      expect(yield* Effect.promise(() => readdir(directory))).toEqual([
        basename(paths[0]!),
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

// The publish restamps with the wall clock, so the reap reads the live Clock.
effectIt.live(
  "keeps a reused PNG and reaps one unused for more than seven days",
  () =>
    Effect.gen(function* () {
      const parent = yield* testDirectory;
      const directory = excerptTempDirectory(parent);
      const publish = (fingerprint: string) =>
        publishExcerptPng(fingerprint, redPng, directory);
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

effectIt.effect(
  "publishes refreshed pixels for the same Annotation identity",
  () =>
    Effect.gen(function* () {
      const directory = yield* testDirectory;
      const identity = "a".repeat(64);
      const original = yield* publishExcerptPng(identity, redPng, directory);
      const refreshed = yield* publishExcerptPng(identity, bluePng, directory);
      expect(refreshed).not.toBe(original);
      expect(yield* Effect.promise(() => readFile(original))).toEqual(
        Buffer.from(redPng),
      );
      expect(yield* Effect.promise(() => readFile(refreshed))).toEqual(
        Buffer.from(bluePng),
      );
      expect(yield* publishExcerptPng(identity, bluePng, directory)).toBe(
        refreshed,
      );
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

const denied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "link",
});

/** The Node file system, with a link that the system refuses. */
const refusedLink = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) =>
    FileSystem.make({ ...fs, link: () => Effect.fail(denied) }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

effectIt.effect("fails with the refused step and removes the staged file", () =>
  Effect.gen(function* () {
    const directory = yield* testDirectory;
    const exit = yield* Effect.exit(
      publishExcerptPng("a".repeat(64), redPng, directory),
    );
    expect(exit).toEqual(Exit.fail(denied));
    expect(yield* Effect.promise(() => readdir(directory))).toEqual([]);
  }).pipe(Effect.provide(refusedLink)),
);

effectIt.effect("removes the staged file when the publish is interrupted", () =>
  Effect.gen(function* () {
    const directory = yield* testDirectory;
    const staged = yield* Deferred.make<void>();
    // The staged file is written, and the publish then waits in its link.
    const stalledAfterWrite = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fs) =>
        FileSystem.make({
          ...fs,
          link: () =>
            Deferred.succeed(staged, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
        }),
      ),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    const publishing = yield* Effect.forkChild(
      publishExcerptPng("a".repeat(64), redPng, directory).pipe(
        Effect.provide(stalledAfterWrite),
      ),
      { startImmediately: true },
    );
    yield* Deferred.await(staged);
    expect(yield* Effect.promise(() => readdir(directory))).toHaveLength(1);

    yield* Fiber.interrupt(publishing);

    expect(yield* Effect.promise(() => readdir(directory))).toEqual([]);
  }),
);

effectIt.effect(
  "leaves no staged file when the publish is interrupted during its write",
  () =>
    Effect.gen(function* () {
      const directory = yield* testDirectory;
      const writing = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const written = Promise.withResolvers<void>();
      let cleanupStarted = false;
      // As a native write does, the write goes on after an interrupt stops
      // waiting for it, and creates the staged file later.
      const lateWrite = Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fs) =>
          FileSystem.make({
            ...fs,
            writeFile: (path, data) =>
              Effect.promise(async () => {
                writing.resolve();
                await release.promise;
                await writeFile(path, data, { flag: "wx" });
                written.resolve();
              }),
            remove: (path, options) =>
              Effect.sync(() => {
                cleanupStarted = true;
              }).pipe(Effect.andThen(fs.remove(path, options))),
          }),
        ),
      ).pipe(Layer.provide(NodeFileSystem.layer));
      const publishing = yield* Effect.forkChild(
        publishExcerptPng("a".repeat(64), redPng, directory).pipe(
          Effect.provide(lateWrite),
        ),
        { startImmediately: true },
      );
      yield* Effect.promise(() => writing.promise);

      // The interrupt reaches the publish before the fork returns, so a
      // write that the interrupt can stop has started its cleanup here.
      const interrupting = yield* Effect.forkChild(
        Fiber.interrupt(publishing),
        { startImmediately: true },
      );
      expect(cleanupStarted).toBe(false);
      release.resolve();
      yield* Effect.promise(() => written.promise);
      yield* Fiber.join(interrupting);

      expect(yield* Effect.promise(() => readdir(directory))).toEqual([]);
    }),
);
