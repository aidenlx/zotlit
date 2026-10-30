import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Logger,
  PlatformError,
  References,
} from "effect";
import type { FileSystem } from "effect";
import { TestClock } from "effect/testing";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";

import { LogCategory } from "./effect-log-category";
import { isOlderThan, sweepTempDirectory } from "./temp-sweep";
import type { TempSweepOptions } from "./temp-sweep";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "zotlit-temp-sweep-"));
});

afterEach(async () => {
  // A case may leave a directory it made unremovable.
  for (const name of await readdir(directory)) {
    await chmod(join(directory, name), 0o700).catch(() => undefined);
  }
  await rm(directory, { recursive: true, force: true });
});

const names = Effect.promise(async () => (await readdir(directory)).sort());

const write = (name: string) =>
  Effect.promise(() => writeFile(join(directory, name), "x"));

/** A failure a residue rule can report, as the file system reports one. */
const denied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "stat",
});

interface LogRecord {
  readonly level: string;
  readonly message: unknown;
  readonly category: readonly string[];
  readonly annotations: Readonly<Record<string, unknown>>;
}

/** A logger layer that records every log, at every level, into `records`. */
function capture(records: LogRecord[]) {
  return Logger.layer([
    Logger.make(({ logLevel, message, fiber }) => {
      records.push({
        level: logLevel,
        message,
        category: fiber.getRef(LogCategory),
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    }),
  ]);
}

/** Run the sweep over the Node file system and return what it logged. */
const logsOf = Effect.fnUntraced(function* (
  sweepOptions: TempSweepOptions<never>,
) {
  const records: LogRecord[] = [];
  yield* sweepTempDirectory(sweepOptions).pipe(
    Effect.provide(capture(records)),
  );
  return records;
});

/**
 * Run the sweep in its own fiber and return what it logged and how it ended.
 * `early` interrupts the fiber before it starts.
 */
const interruptedLogsOf = Effect.fnUntraced(function* (
  sweepOptions: TempSweepOptions<never>,
  { early = false }: { early?: boolean } = {},
) {
  const records: LogRecord[] = [];
  const run = yield* Effect.forkChild(
    sweepTempDirectory(sweepOptions).pipe(Effect.provide(capture(records))),
    { startImmediately: false },
  );
  if (early) run.interruptUnsafe();
  return { records, exit: yield* Fiber.await(run) };
});

/** `self` over the real Node file system, in the case's temp directory. */
const onDisk = <A, E>(self: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.provide(self, NodeFileSystem.layer);

const byPath = (records: readonly LogRecord[]) =>
  records
    .toSorted((a, b) =>
      String(a.annotations["path"]).localeCompare(
        String(b.annotations["path"]),
      ),
    )
    .map(({ level, annotations }) => [level, annotations["path"]]);

describe("sweepTempDirectory", () => {
  it.effect("removes only the entries the residue rule claims", () =>
    onDisk(
      Effect.gen(function* () {
        yield* write("keep");
        yield* write("drop");
        yield* Effect.promise(() => mkdir(join(directory, "drop-dir")));
        yield* write(join("drop-dir", "nested"));
        yield* sweepTempDirectory({
          directory,
          kind: "test entry",
          isResidue: (name, path) =>
            Effect.succeed(
              name.startsWith("drop") && path === join(directory, name),
            ),
        });
        expect(yield* names).toEqual(["keep"]);
      }),
    ),
  );

  it.effect("logs nothing for a directory that does not exist", () =>
    onDisk(
      Effect.gen(function* () {
        const records = yield* logsOf({
          directory: join(directory, "absent"),
          kind: "test entry",
          isResidue: () => Effect.succeed(true),
        });
        expect(records).toEqual([]);
      }),
    ),
  );

  it.effect("logs nothing when interrupted before or during the walk", () =>
    onDisk(
      Effect.gen(function* () {
        yield* write("drop");
        yield* write("other");
        const before = yield* interruptedLogsOf(
          {
            directory,
            kind: "test entry",
            isResidue: () => Effect.succeed(true),
          },
          { early: true },
        );
        const during = yield* interruptedLogsOf({
          directory,
          kind: "test entry",
          isResidue: () => Effect.interrupt,
        });
        for (const { records, exit } of [before, during]) {
          expect(records).toEqual([]);
          expect(
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
          ).toBe(true);
        }
        expect(yield* names).toEqual(["drop", "other"]);
      }),
    ),
  );

  it.effect(
    "logs each reaped entry at debug under the temp-sweep category",
    () =>
      onDisk(
        Effect.gen(function* () {
          yield* write("drop");
          const records = yield* logsOf({
            directory,
            kind: "test entry",
            isResidue: () => Effect.succeed(true),
          });
          expect(records).toEqual([
            {
              level: "Debug",
              message: ["Reaped a stale ZotLit temp entry"],
              category: ["temp-sweep"],
              annotations: {
                path: join(directory, "drop"),
                kind: "test entry",
              },
            },
          ]);
        }),
      ),
  );

  it.effect(
    "warns for an entry the residue rule fails on and keeps walking",
    () =>
      onDisk(
        Effect.gen(function* () {
          yield* write("a-unreadable");
          yield* write("b-drop");
          const records = yield* logsOf({
            directory,
            kind: "test entry",
            isResidue: (name) =>
              name === "a-unreadable"
                ? Effect.fail(denied)
                : Effect.succeed(true),
          });
          expect(byPath(records)).toEqual([
            ["Warn", join(directory, "a-unreadable")],
            ["Debug", join(directory, "b-drop")],
          ]);
          expect(records.find(({ level }) => level === "Warn")).toMatchObject({
            message: expect.arrayContaining([
              "Failed to check a ZotLit temp entry",
            ]),
            category: ["temp-sweep"],
          });
          expect(yield* names).toEqual(["a-unreadable"]);
        }),
      ),
  );

  it.effect("warns once when the path is not a directory", () =>
    onDisk(
      Effect.gen(function* () {
        const file = join(directory, "file");
        yield* write("file");
        const records = yield* logsOf({
          directory: file,
          kind: "test entry",
          isResidue: () => Effect.succeed(true),
        });
        expect(records).toEqual([
          expect.objectContaining({
            level: "Warn",
            message: expect.arrayContaining([
              "Failed to sweep a ZotLit temp directory",
            ]),
            category: ["temp-sweep"],
            annotations: { directory: file, kind: "test entry" },
          }),
        ]);
      }),
    ),
  );

  // Removing the entry inside a read-only directory fails; root ignores modes.
  it.effect.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "logs a failed removal and keeps walking",
    () =>
      onDisk(
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await writeFile(join(directory, "a-drop"), "x");
            await mkdir(join(directory, "b-locked"));
            await writeFile(join(directory, "b-locked", "inner"), "x");
            await chmod(join(directory, "b-locked"), 0o500);
            await writeFile(join(directory, "c-drop"), "x");
          });
          const records = yield* logsOf({
            directory,
            kind: "test entry",
            isResidue: () => Effect.succeed(true),
          });
          // The walk order is the filesystem's, so compare by path.
          expect(byPath(records)).toEqual([
            ["Debug", join(directory, "a-drop")],
            ["Warn", join(directory, "b-locked")],
            ["Debug", join(directory, "c-drop")],
          ]);
          expect(
            records.find(({ level }) => level === "Warn")?.message,
          ).toEqual(
            expect.arrayContaining([
              "Failed to reap a stale ZotLit temp entry",
            ]),
          );
          expect(yield* names).toEqual(["b-locked"]);
        }),
      ),
  );
});

describe("isOlderThan", () => {
  /** The entry's mtime, in seconds since the epoch, as `utimes` takes it. */
  const STAMP = 1_000_000;

  it.effect("ages an entry from its mtime against the Clock", () =>
    onDisk(
      Effect.gen(function* () {
        const path = join(directory, "entry");
        yield* write("entry");
        yield* Effect.promise(() => utimes(path, STAMP, STAMP));
        yield* TestClock.setTime(STAMP * 1000);
        yield* TestClock.adjust(Duration.hours(2));
        expect(yield* isOlderThan(path, Duration.hours(1))).toBe(true);
        expect(yield* isOlderThan(path, Duration.hours(3))).toBe(false);
      }),
    ),
  );

  it.effect("calls an entry that vanished not older than anything", () =>
    onDisk(
      Effect.gen(function* () {
        expect(yield* isOlderThan(join(directory, "gone"), Duration.zero)).toBe(
          false,
        );
      }),
    ),
  );
});
