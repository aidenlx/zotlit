// The real Note Index layer over a test's Obsidian host.
import { Context, Effect, Layer } from "effect";
import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type { CachedMetadata } from "obsidian";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";

import { layerNoteIndex, NoteIndex } from "./service";

export const noteIndexOver = (host: HostSources) =>
  layerNoteIndex.pipe(Layer.provide(layerHost(host)));

export const noteIndexOf = Effect.fn("fixture.noteIndexOf")(function* (
  host: HostSources,
) {
  return Context.get(yield* Layer.build(noteIndexOver(host)), NoteIndex);
});

export function buildNoteIndex(host: HostSources, stack: AsyncDisposableStack) {
  const runtime = buildRuntime(noteIndexOver(host), stack);
  return Object.assign(runtime.runSync(NoteIndex), {
    runtime,
    bridge: effectBridge(runtime),
  });
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
  const noteIndex = buildNoteIndex(host, stack);
  await noteIndex.bridge.runPromise(noteIndex.whenIndexed);
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
      await noteIndex.bridge.runPromise(noteIndex.whenSettled);
    },
  };
}

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

/** The in-memory vault, whose files carry the name, extension and mtime the index reads. */
class MockVault extends MemoryVault {
  /** Hold a file at `path`, without `create`: a file the vault loaded with. */
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
    this.trigger("rename", file, oldPath);
    return file;
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);

    this.files.delete(path);
    this.trigger("delete", file);
  }
}

export interface Harness {
  metadataCache: MockMetadataCache;
  workspace: MemoryWorkspace;
  service: NoteIndex["Service"] & {
    bridge: EffectBridge;
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
  const host = createNoteHost(files, options);
  const resource = yield* Effect.acquireDisposable(
    Effect.tryPromise(async () => makeResource(host)),
  );
  return {
    ...host,
    service: resource.service,
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
  };
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

function makeResource(host: HostSources) {
  const stack = new AsyncDisposableStack();
  return {
    service: buildNoteIndex(host, stack),
    close: () => stack.disposeAsync(),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

/** The vault, metadata cache and workspace of a test host holding `files`. */
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
  if (options.enabledAtRuntime) metadataCache.watchVault(vault);

  for (const [path, fileCache] of Object.entries(files)) {
    vault.addFile(path);
    metadataCache.setCache(path, fileCache);
  }

  return { metadataCache, workspace, vault };
}
