import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { TAbstractFile } from "obsidian";
import { describe, expect, vi } from "vitest";

import { filenameSuffix } from "@zotlit/templates";

import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerVaultFrom } from "@/lib/obsidian-vault";

import { EmptyFilenameError } from "./filename";
import { NotePathUnavailable, resolveRenderedNotePath } from "./note-path";

const FILE = stubService<TAbstractFile>("TAbstractFile", {});

/** A vault that holds the files at `paths`. */
const holding = (paths: Iterable<string>) => {
  const taken = new Set(paths);
  return MemoryVault.with({
    getAbstractFileByPath: (path: string) => (taken.has(path) ? FILE : null),
  });
};

const resolveIn = (
  vault: MemoryVault,
  rendered: string,
  reserved?: ReadonlySet<string>,
) =>
  resolveRenderedNotePath("literatures", rendered, reserved).pipe(
    Effect.provide(layerVaultFrom(vault)),
  );

describe("resolveRenderedNotePath", () => {
  it.effect("routes a slash in the rendered name into a subfolder", () =>
    Effect.gen(function* () {
      const { path } = yield* resolveIn(holding([]), "2020/smith:a");
      expect(path).toBe("literatures/2020/smith_a.md");
    }),
  );

  it.effect.each([
    ["empty input", ""],
    ["trailing slash leaves empty name", "smith2020/"],
    ["suffix marker alone", filenameSuffix()],
  ] as const)("fails with an empty filename for %s", ([, input]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(resolveIn(holding([]), input));
      expect(error).toBeInstanceOf(NotePathUnavailable);
      expect(error.cause).toBeInstanceOf(EmptyFilenameError);
    }),
  );

  it.effect("returns the base name when there is no suffix marker", () =>
    Effect.gen(function* () {
      const { path } = yield* resolveIn(
        holding(["literatures/smith2020.md"]),
        "smith2020",
      );
      expect(path).toBe("literatures/smith2020.md");
    }),
  );

  it.effect("drops the marker when the base name is free", () =>
    Effect.gen(function* () {
      const { path } = yield* resolveIn(
        holding([]),
        `smith2020${filenameSuffix()}`,
      );
      expect(path).toBe("literatures/smith2020.md");
    }),
  );

  it.effect("appends a random suffix when the base name collides", () =>
    Effect.gen(function* () {
      const { path } = yield* resolveIn(
        holding(["literatures/smith2020.md"]),
        `smith2020${filenameSuffix(6)}`,
      );
      expect(path).toMatch(/^literatures\/smith2020_[A-Za-z0-9]{6}\.md$/);
    }),
  );

  it.effect("counts a reserved path as taken", () =>
    Effect.gen(function* () {
      const { path } = yield* resolveIn(
        holding([]),
        `smith2020${filenameSuffix(6)}`,
        new Set(["literatures/smith2020.md"]),
      );
      expect(path).toMatch(/^literatures\/smith2020_[A-Za-z0-9]{6}\.md$/);
    }),
  );

  it.effect("retries until it finds a free suffixed path", () =>
    Effect.gen(function* () {
      const lookup = vi
        .fn<(path: string) => TAbstractFile | null>()
        .mockReturnValueOnce(FILE) // base collides
        .mockReturnValueOnce(FILE) // first suffix collides
        .mockReturnValue(null); // second suffix is free
      const { path } = yield* resolveIn(
        MemoryVault.with({ getAbstractFileByPath: lookup }),
        `smith2020${filenameSuffix(6)}`,
      );
      expect(path).toMatch(/^literatures\/smith2020_[A-Za-z0-9]{6}\.md$/);
      expect(lookup).toHaveBeenCalledTimes(3);
    }),
  );

  it.effect(
    "fails rather than returning a colliding path when every attempt collides",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          resolveIn(
            MemoryVault.with({ getAbstractFileByPath: () => FILE }),
            `smith2020${filenameSuffix(6)}`,
          ),
        );
        expect(error).toBeInstanceOf(NotePathUnavailable);
        expect(error.message).toMatch(/Could not find an available filename/);
      }),
  );
});
