// A test host for the Cited By Sidebar: the plugin's view registry over
// in-memory Obsidian sources and a Citation Index whose observers the test
// drives.
import { Effect, Layer } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { TFile } from "obsidian";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { buildRuntime } from "@/lib/effect-layer";
import { makeViewRegistry } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitedBySnapshot } from "@/services/citation-index/service";

export interface CitedByHost {
  /** The view registry, with no idle delay: an unread observer stops at once. */
  readonly registry: AtomRegistry.AtomRegistry;
  readonly workspace: MemoryWorkspace;
  /** Each key an observer started for, in order. */
  readonly started: readonly string[];
  /** Each key an observer stopped for, in order. */
  readonly stopped: readonly string[];
  /** Sends `snapshot` to the live observer of `key`; false with none. */
  publish(key: string, snapshot: CitedBySnapshot): boolean;
  /**
   * Makes `path` the active file: a note of `key`, or a note with no key.
   * `null` leaves no file active.
   */
  follow(path: string | null, key?: string | null): TFile | null;
  /** Moves the file at `path`, its cache entry with it, as Obsidian does. */
  rename(path: string, next: string): void;
  /** Deletes the file at `path`; it stays the active file. */
  remove(path: string): void;
  close(): Promise<void>;
}

export async function makeCitedByHost(): Promise<CitedByHost> {
  const vault = new MemoryVault();
  const metadataCache = new MemoryMetadataCache();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const started: string[] = [];
  const stopped: string[] = [];
  const observers = new Map<string, (snapshot: CitedBySnapshot) => void>();
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.merge(
      layerHost({ vault, metadataCache, workspace }),
      Layer.mock(CitationIndex, {
        observeCitedBy: (key, callback) =>
          Effect.sync(() => {
            started.push(key);
            observers.set(key, callback);
            return () => {
              observers.delete(key);
              stopped.push(key);
            };
          }),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    workspace,
    started,
    stopped,
    publish: (key, snapshot) => {
      const observer = observers.get(key);
      observer?.(snapshot);
      return observer !== undefined;
    },
    follow: (path, key = null) => {
      if (path === null) {
        workspace.open(null);
        return null;
      }
      const file = vault.getFileByPath(path) ?? vault.add(path);
      file.extension = path.slice(path.lastIndexOf(".") + 1);
      metadataCache.setCache(path, {
        frontmatter: key === null ? {} : { "zotero-key": key },
      });
      workspace.open(file);
      return file;
    },
    rename: (path, next) => {
      const file = vault.getFileByPath(path);
      if (!file) throw new Error(`no file at ${path}`);
      const cache = metadataCache.getCache(path);
      if (cache) metadataCache.setCache(next, cache);
      vault.rename(file, next);
    },
    remove: (path) => vault.remove(path),
    close: async () => {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
