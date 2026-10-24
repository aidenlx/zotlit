import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";

import { Effect, Logger, References } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { LogCategory } from "./effect-log-category";
import { sweepTempDirectory, sweepTempDirectoryEffect } from "./temp-sweep";

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

async function names(): Promise<string[]> {
  return (await readdir(directory)).sort();
}

/** The sweep under test, with a residue rule the case supplies. */
function sweep(
  isResidue: (name: string, path: string) => Promise<boolean> | boolean,
  signal?: AbortSignal,
): Promise<void> {
  return sweepTempDirectory({
    directory,
    kind: "test entry",
    isResidue,
    signal,
  });
}

interface LogRecord {
  readonly level: string;
  readonly message: unknown;
  readonly category: readonly string[];
  readonly annotations: Readonly<Record<string, unknown>>;
}

/** Run `sweep` and return what it logged, at every level. */
const logsOf = Effect.fnUntraced(function* (
  sweepOptions: Parameters<typeof sweepTempDirectoryEffect>[0],
) {
  const records: LogRecord[] = [];
  const capture = Logger.make(({ logLevel, message, fiber }) => {
    records.push({
      level: logLevel,
      message,
      category: fiber.getRef(LogCategory),
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });
  yield* sweepTempDirectoryEffect(sweepOptions).pipe(
    Effect.provide(Logger.layer([capture])),
  );
  return records;
});

describe("sweepTempDirectory", () => {
  it("removes only the entries the residue rule claims", async () => {
    await writeFile(join(directory, "keep"), "x");
    await writeFile(join(directory, "drop"), "x");
    await mkdir(join(directory, "drop-dir"));
    await writeFile(join(directory, "drop-dir", "nested"), "x");

    await sweep(
      (name, path) => name.startsWith("drop") && path === join(directory, name),
    );

    expect(await names()).toEqual(["keep"]);
  });

  it("stops at an already-aborted signal without removing anything", async () => {
    await writeFile(join(directory, "drop"), "x");

    await sweep(() => true, AbortSignal.abort());

    expect(await names()).toEqual(["drop"]);
  });

  it("stops mid-walk once the signal aborts, keeping the rest", async () => {
    for (const name of ["a", "b", "c", "d"]) {
      await writeFile(join(directory, name), "x");
    }
    const controller = new AbortController();
    let seen = 0;

    await sweep(() => {
      seen += 1;
      if (seen === 2) controller.abort();
      return false;
    }, controller.signal);

    expect(seen).toBe(2);
    expect(await names()).toEqual(["a", "b", "c", "d"]);
  });

  it("resolves quietly when the directory does not exist", async () => {
    await expect(
      sweepTempDirectory({
        directory: join(directory, "absent"),
        kind: "test entry",
        isResidue: () => true,
      }),
    ).resolves.toBeUndefined();
  });

  it("survives a residue rule that throws, without removing anything", async () => {
    await writeFile(join(directory, "drop"), "x");

    await expect(
      sweep(() => {
        throw new Error("cannot decide");
      }),
    ).resolves.toBeUndefined();
    expect(await names()).toEqual(["drop"]);
  });

  it("removes the entries an asynchronous residue rule claims", async () => {
    await writeFile(join(directory, "keep"), "x");
    await writeFile(join(directory, "drop"), "x");

    await sweep(async (name) => {
      await Promise.resolve();
      return name === "drop";
    });

    expect(await names()).toEqual(["keep"]);
  });
});

describe("sweepTempDirectoryEffect", () => {
  it.effect("logs nothing for a directory that does not exist", () =>
    Effect.gen(function* () {
      const records = yield* logsOf({
        directory: join(directory, "absent"),
        kind: "test entry",
        isResidue: () => true,
      });
      expect(records).toEqual([]);
    }),
  );

  it.effect(
    "logs nothing when the signal aborts before or during the walk",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeFile(join(directory, "drop"), "x"));
        yield* Effect.promise(() => writeFile(join(directory, "other"), "x"));
        const before = yield* logsOf({
          directory,
          kind: "test entry",
          isResidue: () => true,
          signal: AbortSignal.abort(),
        });
        const controller = new AbortController();
        const during = yield* logsOf({
          directory,
          kind: "test entry",
          isResidue: () => {
            controller.abort();
            throw new Error("cannot decide");
          },
          signal: controller.signal,
        });
        expect(before).toEqual([]);
        expect(during).toEqual([]);
        expect(yield* Effect.promise(names)).toEqual(["drop", "other"]);
      }),
  );

  it.effect(
    "logs each reaped entry at debug under the temp-sweep category",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeFile(join(directory, "drop"), "x"));
        const records = yield* logsOf({
          directory,
          kind: "test entry",
          isResidue: () => true,
        });
        expect(records).toEqual([
          {
            level: "Debug",
            message: ["Reaped a stale ZotLit temp entry"],
            category: ["temp-sweep"],
            annotations: { path: join(directory, "drop"), kind: "test entry" },
          },
        ]);
      }),
  );

  it.effect("warns once and does not fail when the residue rule throws", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeFile(join(directory, "drop"), "x"));
      const records = yield* logsOf({
        directory,
        kind: "test entry",
        isResidue: () => {
          throw new Error("cannot decide");
        },
      });
      expect(records).toEqual([
        expect.objectContaining({
          level: "Warn",
          message: expect.arrayContaining([
            "Failed to sweep a ZotLit temp directory",
          ]),
          category: ["temp-sweep"],
          annotations: { directory, kind: "test entry" },
        }),
      ]);
      expect(yield* Effect.promise(names)).toEqual(["drop"]);
    }),
  );

  it.effect("warns when the path is not a directory", () =>
    Effect.gen(function* () {
      const file = join(directory, "file");
      yield* Effect.promise(() => writeFile(file, "x"));
      const records = yield* logsOf({
        directory: file,
        kind: "test entry",
        isResidue: () => true,
      });
      expect(records.map(({ level }) => level)).toEqual(["Warn"]);
    }),
  );

  it.effect("accepts an asynchronous residue rule", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeFile(join(directory, "keep"), "x"));
      yield* Effect.promise(() => writeFile(join(directory, "drop"), "x"));
      yield* sweepTempDirectoryEffect({
        directory,
        kind: "test entry",
        isResidue: async (name) => {
          await Promise.resolve();
          return name === "drop";
        },
      });
      expect(yield* Effect.promise(names)).toEqual(["keep"]);
    }),
  );

  // Removing the entry inside a read-only directory fails; root ignores modes.
  it.effect.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "logs a failed removal and keeps walking",
    () =>
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
          isResidue: () => true,
        });
        // The walk order is the filesystem's, so compare by path.
        const byPath = records.toSorted((a, b) =>
          String(a.annotations["path"]).localeCompare(
            String(b.annotations["path"]),
          ),
        );
        expect(
          byPath.map(({ level, annotations }) => [level, annotations["path"]]),
        ).toEqual([
          ["Debug", join(directory, "a-drop")],
          ["Warn", join(directory, "b-locked")],
          ["Debug", join(directory, "c-drop")],
        ]);
        expect(byPath[1]?.message).toEqual(
          expect.arrayContaining(["Failed to reap a stale ZotLit temp entry"]),
        );
        expect(yield* Effect.promise(names)).toEqual(["b-locked"]);
      }),
  );
});
