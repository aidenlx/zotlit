import { it } from "@effect/vitest";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
} from "effect";
import { TFile } from "obsidian";
import type { Vault as VaultApi } from "obsidian";
import { assert, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerVault, layerVaultFrom, Vault } from "@/lib/obsidian-vault";
import type { VaultEvent } from "@/lib/obsidian-vault";

import { MemoryVault } from "./__fixtures__/obsidian-vault";

const NAMES = ["create", "modify", "rename", "delete"] as const;

/** The layer built on a Scope of its own, closed with the case's Scope. */
const open = Effect.fnUntraced(function* (layer: Layer.Layer<Vault>) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const context = yield* Layer.buildWithScope(layer, scope);
  return { scope, vault: Context.get(context, Vault) };
});

it.effect("owns one listener per event name until the layer closes", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const { scope } = yield* open(layerVaultFrom(source));
    expect(NAMES.map((name) => source.listenerCount(name))).toEqual([
      1, 1, 1, 1,
    ]);
    yield* Scope.close(scope, Exit.void);
    expect(NAMES.map((name) => source.listenerCount(name))).toEqual([
      0, 0, 0, 0,
    ]);
  }),
);

it.effect("reads the live layer's vault from ObsidianApp", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const note = source.add("a.md", "text");
    const folder = source.addFolder("notes");
    const { vault } = yield* open(
      layerVault.pipe(
        Layer.provide(
          Layer.succeed(
            ObsidianApp,
            stubService<ObsidianApp["Service"]>("ObsidianApp", {
              vault: source as unknown as VaultApi,
            }),
          ),
        ),
      ),
    );
    expect(yield* vault.getFileByPath("a.md")).toBe(note);
    expect(yield* vault.getFileByPath("b.md")).toBeNull();
    expect(yield* vault.getFolderByPath("notes")).toBe(folder);
    expect(yield* vault.getFolderByPath("a.md")).toBeNull();
    expect(yield* vault.read(note)).toBe("text");
    expect(yield* vault.cachedRead(note)).toBe("text");
  }),
);

it.effect(
  "reads a path through the adapter, failing FileNotFound on ENOENT",
  () =>
    Effect.gen(function* () {
      const source = new MemoryVault();
      source.contents.set("raw.md", "on disk");
      const { vault } = yield* open(layerVaultFrom(source));
      expect(yield* vault.readPath("raw.md")).toBe("on disk");
      const error = yield* Effect.flip(vault.readPath("gone.md"));
      expect(error).toMatchObject({
        _tag: "FileNotFound",
        path: "gone.md",
        cause: { code: "ENOENT" },
      });
    }),
);

it.effect("fails any other adapter rejection with VaultError", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const denied = Object.assign(new Error("EACCES: raw.md"), {
      code: "EACCES",
    });
    Object.assign(source.adapter, { read: () => Promise.reject(denied) });
    const { vault } = yield* open(layerVaultFrom(source));
    const error = yield* Effect.flip(vault.readPath("raw.md"));
    expect(error).toMatchObject({
      _tag: "VaultError",
      operation: "readPath",
      path: "raw.md",
      message: "EACCES: raw.md",
      cause: denied,
    });
  }),
);

it.effect("lists the vault's Markdown files", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const note = Object.assign(source.add("a.md"), { extension: "md" });
    Object.assign(source.add("b.pdf"), { extension: "pdf" });
    const { vault } = yield* open(layerVaultFrom(source));
    expect(yield* vault.getMarkdownFiles).toEqual([note]);
  }),
);

it.effect("writes through process, create and trash", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const { vault } = yield* open(layerVaultFrom(source));
    const note = yield* vault.create("a.md", "one");
    expect(source.getFileByPath("a.md")).toBe(note);
    expect(yield* vault.process(note, (text) => `${text} two`)).toBe("one two");
    expect(source.contents.get("a.md")).toBe("one two");
    yield* vault.trash(note, false);
    expect(source.trashed).toEqual([note]);
    expect(source.getFileByPath("a.md")).toBeNull();
  }),
);

it.effect(
  "fails create with FileExists when the vault cache holds the path",
  () =>
    Effect.gen(function* () {
      const source = new MemoryVault();
      source.add("a.md", "held");
      source.addFolder("Folder");
      const { vault } = yield* open(layerVaultFrom(source));
      const create = vi.spyOn(source, "create");
      const file = yield* Effect.flip(vault.create("a.md", ""));
      const folder = yield* Effect.flip(vault.create("Folder", ""));
      expect([file._tag, file.path]).toEqual(["FileExists", "a.md"]);
      expect([folder._tag, folder.path]).toEqual(["FileExists", "Folder"]);
      expect(create).not.toHaveBeenCalled();
      expect(source.contents.get("a.md")).toBe("held");
    }),
);

it.effect(
  "fails a rejected call with VaultError, keeping Obsidian's error",
  () =>
    Effect.gen(function* () {
      const source = new MemoryVault();
      // The cache does not hold `A.md`; a case-insensitive disk still refuses it.
      const refused = new Error("File already exists.");
      vi.spyOn(source, "create").mockRejectedValueOnce(refused);
      const { vault } = yield* open(layerVaultFrom(source));
      const error = yield* Effect.flip(vault.create("A.md", ""));
      assert(error._tag === "VaultError");
      expect([error.operation, error.path, error.message]).toEqual([
        "create",
        "A.md",
        "File already exists.",
      ]);
      expect(error.cause).toBe(refused);
      const missing = new TFile();
      missing.path = "gone.md";
      const read = yield* Effect.flip(vault.read(missing));
      expect([read.operation, read.path]).toEqual(["read", "gone.md"]);
    }),
);

it.effect("streams the events of every name in Obsidian's order", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const { vault } = yield* open(layerVaultFrom(source));
    const received = yield* Queue.unbounded<VaultEvent["_tag"]>();
    yield* forkEach(vault.changes, (event) =>
      Queue.offer(received, event._tag),
    );
    const note = source.add("a.md");
    source.rename(note, "b.md");
    source.modify(note, "text");
    source.remove("b.md");
    const tags = [];
    for (let i = 0; i < 4; i++) tags.push(yield* Queue.take(received));
    expect(tags).toEqual(["create", "rename", "modify", "delete"]);
  }),
);

// A consumer that joins these events with another source's relies on this:
// the event reaches it before Obsidian's next callback runs.
it.effect(
  "hands each event to an idle consumer inside Obsidian's callback",
  () =>
    Effect.gen(function* () {
      const source = new MemoryVault();
      const { vault } = yield* open(layerVaultFrom(source));
      const handled: string[] = [];
      yield* forkEach(filterTag(vault.changes, "create"), (event) => {
        handled.push(event.file.path);
      });
      source.add("a.md");
      expect(handled).toEqual(["a.md"]);
    }),
);

it.effect("carries Obsidian's arguments on each event", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    const { vault } = yield* open(layerVaultFrom(source));
    const fiber = yield* vault.changes.pipe(
      Stream.take(2),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    );
    const note = source.add("a.md");
    source.rename(note, "b.md");
    expect([...(yield* Fiber.join(fiber))]).toEqual([
      { _tag: "create", file: note },
      { _tag: "rename", file: note, oldPath: "a.md" },
    ]);
  }),
);

it.effect("gives FileExists Obsidian's own message", () =>
  Effect.gen(function* () {
    const source = new MemoryVault();
    source.add("a.md");
    const { vault } = yield* open(layerVaultFrom(source));
    const error = yield* Effect.flip(vault.create("a.md", ""));
    expect(error.message).toBe("File already exists.");
  }),
);
