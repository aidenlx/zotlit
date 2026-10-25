// The real Note Index layer over a test's Obsidian host.
import { Context, Effect, Layer } from "effect";
import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef } from "obsidian";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { buildRuntime } from "@/lib/effect-layer";

import type { PlainNoteIndex } from "./plain";
import { plainNoteIndex } from "./plain";
import { layerNoteIndex, NoteIndex } from "./service";

export const noteIndexOver = (app: App) =>
  layerNoteIndex.pipe(Layer.provide(layerHostApp(app)));

export const noteIndexOf = Effect.fn("fixture.noteIndexOf")(function* (
  app: App,
) {
  return Context.get(yield* Layer.build(noteIndexOver(app)), NoteIndex);
});

export function buildNoteIndex(app: App, stack: AsyncDisposableStack) {
  const runtime = buildRuntime(noteIndexOver(app), stack);
  return Object.assign(plainNoteIndex(runtime), { runtime });
}

/**
 * The real Note Index for a consumer suite, over a host of its own. The plugin
 * was enabled at runtime, so the Full Scan is done once this resolves.
 *
 * @param notes each Literature Note's path, and the Item key it carries.
 * @param stack owns the index's runtime.
 */
export async function openNoteVault(
  notes: Record<string, string>,
  stack: AsyncDisposableStack,
) {
  const host = createNoteHost(
    Object.fromEntries(
      Object.entries(notes).map(([path, itemKey]) => [
        path,
        cache({ itemKey }),
      ]),
    ),
    { enabledAtRuntime: true },
  );
  const noteIndex = buildNoteIndex(host.app, stack);
  await noteIndex.whenIndexed();
  return {
    ...host,
    noteIndex,
    /**
     * The note at `path`, created when the vault holds none, now carries
     * `itemKey`, or no key; resolves once the Note Index has read the edit.
     */
    writeNote: async (
      path: string,
      itemKey: string | undefined,
    ): Promise<void> => {
      const file = host.vault.files.get(path) ?? host.vault.addFile(path);
      host.metadataCache.change(file, cache({ itemKey }));
      await noteIndex.whenSettled();
    },
  };
}

type Callback = (...args: unknown[]) => void;
type VaultEvent = "create" | "modify" | "rename" | "delete";

/** The in-memory metadata cache, following the vault as Obsidian's does. */
class MockMetadataCache extends MemoryMetadataCache {
  /**
   * Obsidian's `watchVaultChanges()`: the cache follows a rename or delete as
   * one more vault listener, in registration order. It subscribes once its
   * initial load is done, so a plugin loaded during startup hears a rename
   * before the cache rekeys; one enabled at runtime hears it after.
   */
  watchVault(vault: MockVault): void {
    vault.on("rename", (...args) => {
      const [file, oldPath] = args as [TFile, string];
      const cache = this.entries.get(oldPath);
      if (!cache) return;
      this.entries.delete(oldPath);
      this.entries.set(file.path, cache);
    });
    vault.on("delete", (file) => {
      this.entries.delete((file as TFile).path);
    });
  }
}

class MockVault {
  readonly files = new Map<string, TFile>();

  readonly #listeners: Record<VaultEvent, Set<Callback>> = {
    create: new Set(),
    modify: new Set(),
    rename: new Set(),
    delete: new Set(),
  };

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  on(name: VaultEvent, callback: Callback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: VaultEvent;
      callback: Callback;
    };
    this.#listeners[name].delete(callback);
  }

  addFile(path: string, mtime = 0): TFile {
    const file = makeFile(path, mtime);
    this.files.set(path, file);
    return file;
  }

  renameFile(oldPath: string, newPath: string): TFile {
    const file = this.files.get(oldPath);
    if (!file) throw new Error(`Missing file: ${oldPath}`);

    this.files.delete(oldPath);
    updateFilePath(file, newPath);
    this.files.set(newPath, file);
    this.#emit("rename", file, oldPath);
    return file;
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);

    this.files.delete(path);
    this.#emit("delete", file);
  }

  #emit(name: VaultEvent, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]) callback(...args);
  }
}

export interface Harness {
  app: App;
  metadataCache: MockMetadataCache;
  workspace: MemoryWorkspace;
  service: PlainNoteIndex & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
  };
  close: () => Promise<void>;
  vault: MockVault;
}

/**
 * `enabledAtRuntime: true` is the runtime-enable shape: layout ready, cache
 * clean. The default is plugin load during startup: neither yet, both settle
 * on `startup()`.
 */
export const makeHarness = Effect.fn("fixture.makeHarness")(function* (
  files: Record<string, CachedMetadata>,
  options: { enabledAtRuntime?: boolean } = {},
) {
  const { app, metadataCache, workspace, vault } = createNoteHost(
    files,
    options,
  );
  const resource = yield* Effect.acquireDisposable(
    Effect.tryPromise(async () => makeResource(app)),
  );
  return {
    app,
    metadataCache,
    workspace,
    service: resource.service,
    vault,
    close: resource.close,
  };
});

/**
 * Obsidian's startup order: the cache finishes its initial load and starts
 * following the vault, drains, then layout is ready.
 */
export function startup(
  harness: Pick<Harness, "metadataCache" | "workspace" | "vault">,
): void {
  harness.metadataCache.watchVault(harness.vault);
  harness.metadataCache.resolve();
  harness.workspace.layoutReady();
}

export function cache(options: {
  itemKey?: unknown;
  properties?: Record<string, unknown>;
}): CachedMetadata {
  const frontmatter: Record<string, unknown> = { ...options.properties };
  if (options.itemKey !== undefined)
    frontmatter[FIELD_ZOTERO_KEY] = options.itemKey;

  return {
    frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
  } as CachedMetadata;
}

export function paths(files: TFile[]): string[] {
  return files.map((file) => file.path);
}

export function makeFile(path: string, mtime = 0): TFile {
  const file = new TFile();
  file.stat = { ctime: 0, mtime, size: 0 };
  updateFilePath(file, path);
  return file;
}

function updateFilePath(file: TFile, path: string): void {
  const name = basename(path);
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.[^.]+$/, "");
  file.extension = name.includes(".") ? name.split(".").at(-1)! : "";
}

function makeResource(app: App) {
  const stack = new AsyncDisposableStack();
  return {
    service: buildNoteIndex(app, stack),
    close: () => stack.disposeAsync(),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

export function createNoteHost(
  files: Record<string, CachedMetadata>,
  options: { enabledAtRuntime?: boolean } = {},
) {
  const metadataCache = new MockMetadataCache();
  const workspace = new MemoryWorkspace({
    layoutReady: options.enabledAtRuntime,
  });
  metadataCache.clean = options.enabledAtRuntime ?? false;
  const vault = new MockVault();
  const app = { metadataCache, vault, workspace } as unknown as App;
  if (options.enabledAtRuntime) metadataCache.watchVault(vault);

  for (const [path, fileCache] of Object.entries(files)) {
    vault.addFile(path);
    metadataCache.setCache(path, fileCache);
  }

  return { app, metadataCache, workspace, vault };
}
