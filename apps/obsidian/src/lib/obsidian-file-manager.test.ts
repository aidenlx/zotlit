import { TFile } from "obsidian";
import type { App, FileManager as FileManagerApi } from "obsidian";
import { expect } from "vitest";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Effect, Exit, Layer } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  FileManager,
  layerFileManager,
  layerFileManagerFrom,
} from "@/lib/obsidian-file-manager";
import { VaultError } from "@/lib/vault-errors";

import { MemoryFileManager } from "./__fixtures__/obsidian-file-manager";

function file(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const over = (source: MemoryFileManager) =>
  Effect.service(FileManager).pipe(
    Effect.provide(layerFileManagerFrom(source)),
  );

it.effect("changes a note's Properties through processFrontMatter", () =>
  Effect.gen(function* () {
    const source = new MemoryFileManager();
    source.frontmatter.set("a.md", { title: "A" });
    const files = yield* over(source);
    yield* files.processFrontMatter(file("a.md"), (frontmatter) => {
      frontmatter.tags = ["read"];
    });
    expect(source.frontmatter.get("a.md")).toEqual({
      title: "A",
      tags: ["read"],
    });
  }),
);

it.effect("moves a file to the new path through renameFile", () =>
  Effect.gen(function* () {
    const source = new MemoryFileManager();
    const files = yield* over(source);
    const note = file("a.md");
    yield* files.renameFile(note, "notes/a.md");
    expect(note.path).toBe("notes/a.md");
    expect(source.renames).toEqual([{ from: "a.md", to: "notes/a.md" }]);
  }),
);

it.effect("forwards subpath and alias to Obsidian's generateMarkdownLink", () =>
  Effect.gen(function* () {
    const files = yield* over(new MemoryFileManager());
    expect(
      yield* files.generateMarkdownLink(file("a.md"), "b.md", {
        subpath: "#h",
        alias: "A",
      }),
    ).toBe("[[a.md#h|A]]");
  }),
);

it.effect(
  "fails a rejected rename with VaultError and Obsidian's message",
  () =>
    Effect.gen(function* () {
      const source = new MemoryFileManager();
      const cause = new Error("Destination file already exists!");
      source.failNext = cause;
      const files = yield* over(source);
      const exit = yield* Effect.exit(files.renameFile(file("a.md"), "b.md"));
      expect(exit).toEqual(
        Exit.fail(
          new VaultError({
            operation: "renameFile",
            path: "a.md",
            message: "Destination file already exists!",
            cause,
          }),
        ),
      );
    }),
);

it.effect("fails processFrontMatter with VaultError when fn throws", () =>
  Effect.gen(function* () {
    const files = yield* over(new MemoryFileManager());
    const error = yield* Effect.flip(
      files.processFrontMatter(file("a.md"), () => {
        throw new Error("bad value");
      }),
    );
    expect(error).toBeInstanceOf(VaultError);
    expect(error.operation).toBe("processFrontMatter");
    expect(error.path).toBe("a.md");
    expect(error.message).toBe("bad value");
  }),
);

it.effect("reads the live layer's file manager from ObsidianApp", () =>
  Effect.gen(function* () {
    const source = new MemoryFileManager();
    const files = yield* Effect.service(FileManager).pipe(
      Effect.provide(
        layerFileManager.pipe(
          Layer.provide(
            Layer.succeed(
              ObsidianApp,
              stubService<ObsidianApp["Service"]>("ObsidianApp", {
                fileManager: source as unknown as FileManagerApi,
              }),
            ),
          ),
        ),
      ),
    );
    const note = file("a.md");
    yield* files.renameFile(note, "b.md");
    expect(note.path).toBe("b.md");
  }),
);

// Test hosts that never touch the file manager stub no `fileManager`.
it.effect("builds over a test host's app that has no file manager", () =>
  Effect.gen(function* () {
    const app = { metadataCache: { on() {}, offref() {} } } as unknown as App;
    yield* Effect.service(FileManager).pipe(Effect.provide(layerHostApp(app)));
  }),
);
