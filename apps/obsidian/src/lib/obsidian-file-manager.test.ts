import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import type {
  App,
  FileManager as FileManagerApi,
  Vault as VaultApi,
} from "obsidian";
import { expect, vi } from "vitest";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  FileManager,
  layerFileManager,
  layerFileManagerFrom,
} from "@/lib/obsidian-file-manager";
import { layerVault, layerVaultFrom } from "@/lib/obsidian-vault";
import { VaultError } from "@/lib/vault-errors";

import { MemoryFileManager } from "./__fixtures__/obsidian-file-manager";
import { MemoryVault } from "./__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "./__fixtures__/obsidian-workspace";

function file(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const over = (source: MemoryFileManager, vault = new MemoryVault()) =>
  Effect.service(FileManager).pipe(
    Effect.provide(
      layerFileManagerFrom(source).pipe(Layer.provide(layerVaultFrom(vault))),
    ),
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

it.effect(
  "fails renameFile with FileExists when the vault cache holds the path",
  () =>
    Effect.gen(function* () {
      const source = new MemoryFileManager();
      const vault = new MemoryVault();
      const note = vault.add("a.md");
      vault.add("b.md");
      vault.addFolder("Folder");
      const rename = vi.spyOn(source, "renameFile");
      const files = yield* over(source, vault);
      const onFile = yield* Effect.flip(files.renameFile(note, "b.md"));
      const onFolder = yield* Effect.flip(files.renameFile(note, "Folder"));
      expect([onFile._tag, onFile.path]).toEqual(["FileExists", "b.md"]);
      expect([onFolder._tag, onFolder.path]).toEqual(["FileExists", "Folder"]);
      expect(rename).not.toHaveBeenCalled();
      expect(note.path).toBe("a.md");
    }),
);

it.effect(
  "renames to the file's own path or a case-only change without a collision",
  () =>
    Effect.gen(function* () {
      const source = new MemoryFileManager();
      const vault = new MemoryVault();
      const note = vault.add("a.md");
      const files = yield* over(source, vault);
      yield* files.renameFile(note, "a.md");
      yield* files.renameFile(note, "A.md");
      expect(source.renames).toEqual([
        { from: "a.md", to: "a.md" },
        { from: "a.md", to: "A.md" },
      ]);
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
      const error = yield* Effect.flip(files.renameFile(file("a.md"), "b.md"));
      expect(error).toEqual(
        new VaultError({
          operation: "renameFile",
          path: "a.md",
          message: "Destination file already exists!",
          cause,
        }),
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
          Layer.provide(layerVault),
          Layer.provideMerge(
            Layer.succeed(
              ObsidianApp,
              stubService<ObsidianApp["Service"]>("ObsidianApp", {
                fileManager: source as unknown as FileManagerApi,
                vault: new MemoryVault() as unknown as VaultApi,
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
    const app = {
      metadataCache: { on() {}, offref() {} },
      workspace: new MemoryWorkspace(),
      vault: { on() {}, offref() {} },
    } as unknown as App;
    yield* Effect.service(FileManager).pipe(Effect.provide(layerHostApp(app)));
  }),
);
