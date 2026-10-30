import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  PlatformError,
  Scope,
} from "effect";
import { posix } from "node:path";
import { describe, expect, vi } from "vitest";

import {
  pandocCliFilter,
  pandocDefaults,
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
} from "./filter";
import { pandocIntegrationFiles } from "./integration";
import { savePandocIntegrationFiles } from "./integration-save";

const FOLDER = "/project/pandoc";
const FILTER_PATH = posix.join(FOLDER, PANDOC_FILTER_FILENAME);
const DEFAULTS_PATH = posix.join(FOLDER, PANDOC_DEFAULTS_FILENAME);

class MemoryFileSystem {
  readonly files = new Map<string, string>();
  failRenameTo: string | null = null;
  readonly rename = vi.fn((from: string, to: string) =>
    Effect.suspend(() => {
      if (to === this.failRenameTo) {
        this.failRenameTo = null;
        return Effect.fail(failure("PermissionDenied", `Cannot replace ${to}`));
      }
      const value = this.files.get(from);
      if (value === undefined) return Effect.fail(failure("NotFound", from));
      this.files.delete(from);
      this.files.set(to, value);
      return Effect.void;
    }),
  );
  readonly writeFileString = vi.fn((path: string, value: string) =>
    Effect.suspend(() => {
      if (this.files.has(path))
        return Effect.fail(failure("AlreadyExists", path));
      this.files.set(path, value);
      return Effect.void;
    }),
  );
  readonly service = FileSystem.makeNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        const value = this.files.get(path);
        return value === undefined
          ? Effect.fail(failure("NotFound", path))
          : Effect.succeed(value);
      }),
    makeTempDirectory: () =>
      Effect.succeed(posix.join(FOLDER, ".zotlit-pandoc-test")),
    writeFileString: this.writeFileString,
    rename: this.rename,
    remove: (path, options) =>
      Effect.suspend(() => {
        if (options?.recursive) {
          for (const file of this.files.keys()) {
            if (file.startsWith(`${path}/`)) this.files.delete(file);
          }
        } else if (!this.files.delete(path))
          return Effect.fail(failure("NotFound", path));
        return Effect.void;
      }),
  });
}

function failure(
  _tag: "NotFound" | "AlreadyExists" | "PermissionDenied",
  description: string,
) {
  return PlatformError.systemError({
    _tag,
    module: "FileSystem",
    method: "save",
    description,
  });
}

function save(
  fileSystem: MemoryFileSystem,
  confirmReplacement = vi.fn(() => Effect.succeed(true)),
) {
  return savePandocIntegrationFiles({
    folder: FOLDER,
    files: pandocIntegrationFiles(),
    confirmReplacement,
  }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem.service));
}

describe("savePandocIntegrationFiles", () => {
  it.effect(
    "finishes the pair before its scope closes during an install (#1793)",
    () =>
      Effect.gen(function* () {
        const fileSystem = new MemoryFileSystem();
        fileSystem.files.set(FILTER_PATH, "old filter");
        fileSystem.files.set(DEFAULTS_PATH, "old defaults");
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const service = FileSystem.makeNoop({
          ...fileSystem.service,
          rename: (from, to) =>
            to === FILTER_PATH
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                  yield* fileSystem.rename(from, to);
                })
              : fileSystem.rename(from, to),
        });
        const scope = yield* Scope.fork(yield* Scope.Scope);
        yield* savePandocIntegrationFiles({
          folder: FOLDER,
          files: pandocIntegrationFiles(),
          confirmReplacement: () => Effect.succeed(true),
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, service),
          Effect.forkIn(scope, { startImmediately: true }),
        );
        yield* Deferred.await(started);
        const closing = yield* Scope.close(scope, Exit.void).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        expect(closing.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(closing);
        expect(fileSystem.files.get(FILTER_PATH)).toBe(pandocCliFilter);
        expect(fileSystem.files.get(DEFAULTS_PATH)).toBe(pandocDefaults);
        expect([...fileSystem.files.keys()].sort()).toEqual(
          [DEFAULTS_PATH, FILTER_PATH].sort(),
        );
      }),
  );

  it.effect("cancels before writing when replacement is declined", () =>
    Effect.gen(function* () {
      const fileSystem = new MemoryFileSystem();
      fileSystem.files.set(FILTER_PATH, "old filter");
      const confirmReplacement = vi.fn(() => Effect.succeed(false));
      expect(yield* save(fileSystem, confirmReplacement)).toEqual({
        kind: "cancelled",
      });
      expect(confirmReplacement).toHaveBeenCalledWith([PANDOC_FILTER_FILENAME]);
      expect(fileSystem.files.get(FILTER_PATH)).toBe("old filter");
      expect(fileSystem.writeFileString).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "saves the exact pair without confirmation when both targets are clear",
    () =>
      Effect.gen(function* () {
        const fileSystem = new MemoryFileSystem();
        const confirmReplacement = vi.fn(() => Effect.succeed(true));
        expect(yield* save(fileSystem, confirmReplacement)).toEqual({
          kind: "saved",
          folder: FOLDER,
        });
        expect(confirmReplacement).not.toHaveBeenCalled();
        expect(fileSystem.files.get(FILTER_PATH)).toBe(pandocCliFilter);
        expect(fileSystem.files.get(DEFAULTS_PATH)).toBe(pandocDefaults);
      }),
  );

  it.effect(
    "confirms once and replaces both files when either target exists",
    () =>
      Effect.gen(function* () {
        const fileSystem = new MemoryFileSystem();
        fileSystem.files.set(DEFAULTS_PATH, "old defaults");
        const confirmReplacement = vi.fn(() => Effect.succeed(true));
        expect(yield* save(fileSystem, confirmReplacement)).toMatchObject({
          kind: "saved",
        });
        expect(confirmReplacement).toHaveBeenCalledExactlyOnceWith([
          PANDOC_DEFAULTS_FILENAME,
        ]);
        expect(fileSystem.files.get(FILTER_PATH)).toBe(pandocCliFilter);
        expect(fileSystem.files.get(DEFAULTS_PATH)).toBe(pandocDefaults);
      }),
  );

  it.effect("returns one failure result when replacement fails", () =>
    Effect.gen(function* () {
      const fileSystem = new MemoryFileSystem();
      fileSystem.files.set(FILTER_PATH, "old filter");
      fileSystem.files.set(DEFAULTS_PATH, "old defaults");
      fileSystem.failRenameTo = DEFAULTS_PATH;
      expect(yield* save(fileSystem)).toMatchObject({
        kind: "failed",
        restored: true,
        error: {
          reason: {
            _tag: "PermissionDenied",
            description: `Cannot replace ${DEFAULTS_PATH}`,
          },
        },
      });
    }),
  );

  it.effect("restores the complete prior pair after a failed replacement", () =>
    Effect.gen(function* () {
      const fileSystem = new MemoryFileSystem();
      fileSystem.files.set(FILTER_PATH, "old filter");
      fileSystem.files.set(DEFAULTS_PATH, "old defaults");
      fileSystem.failRenameTo = DEFAULTS_PATH;
      yield* save(fileSystem);
      expect(fileSystem.files.get(FILTER_PATH)).toBe("old filter");
      expect(fileSystem.files.get(DEFAULTS_PATH)).toBe("old defaults");
      expect([...fileSystem.files.keys()].sort()).toEqual(
        [DEFAULTS_PATH, FILTER_PATH].sort(),
      );
    }),
  );
});
