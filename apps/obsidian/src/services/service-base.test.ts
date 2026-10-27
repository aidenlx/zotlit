import { delay } from "@std/async";
import type { App, EventRef } from "obsidian";
import { expect, it, vi } from "vitest";

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";

import { buildNoteIndex } from "./note-index/__fixtures__";
import type { PlainNoteIndex } from "./note-index/plain";
import { Service, ServiceContainer } from "./service-base";

vi.mock("@/lib/log", () => ({
  getLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

type Callback = (...args: never[]) => unknown;

/** Obsidian's `Events`: a listener list per event name, cut by `offref`. */
class FakeEvents {
  readonly listeners = new Map<string, Set<Callback>>();

  on(name: string, callback: Callback): EventRef {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
    const ref = { e: this, name, callback };
    return ref;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: string;
      callback: Callback;
    };
    this.listeners.get(name)?.delete(callback);
  }

  /** Event names that still hold a listener. */
  listened(): string[] {
    return [...this.listeners]
      .filter(([, set]) => set.size > 0)
      .map(([n]) => n);
  }
}

/**
 * A service registered after the Note Index whose teardown reads it, as a
 * view saving its document on close writes through an older service. Its
 * teardown runs until the test lets it end.
 */
class ReadsOnTeardown extends Service {
  ready = Promise.resolve();
  readonly #finish = Promise.withResolvers<void>();
  readonly started = Promise.withResolvers<void>();

  constructor(noteIndex: Pick<PlainNoteIndex, "getIndexedItemKeys">) {
    super();
    const stack = new AsyncDisposableStack();
    stack.defer(async () => {
      noteIndex.getIndexedItemKeys();
      this.started.resolve();
      await this.#finish.promise;
    });
    this.commit(stack);
  }

  finish(): void {
    this.#finish.resolve();
  }
}

it("disposes services newest first, so an older service keeps its vault and metadata cache listeners while a newer one tears down, and none after", async () => {
  const vault = new FakeEvents();
  const metadataCache = new FakeEvents();
  const workspace = new MemoryWorkspace();
  const app = stubService<App>("App", {
    vault: stubService<App["vault"]>("Vault", {
      read: async () => "",
      cachedRead: async () => "",
      process: async () => "",
      create: async () => {
        throw new Error("Unread Vault.create");
      },
      trash: async () => {},
      getFileByPath: () => null,
      getFolderByPath: () => null,
      getAbstractFileByPath: () => null,
      on: (name, callback) => vault.on(name, callback),
      offref: (ref) => vault.offref(ref),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: () => null,
      onCleanCache: () => {},
      on: (name, callback) => metadataCache.on(name, callback),
      offref: (ref) => metadataCache.offref(ref),
    }),
    fileManager: stubService<App["fileManager"]>("FileManager", {}),
    workspace: stubService<App["workspace"]>("Workspace", {
      onLayoutReady: (callback) => workspace.onLayoutReady(callback),
      getActiveFile: () => workspace.getActiveFile(),
      getActiveViewOfType: (type) => workspace.getActiveViewOfType(type),
      on: (name: string, callback: Callback) =>
        workspace.on(name, (...args: unknown[]) =>
          Reflect.apply(callback, undefined, args),
        ),
      offref: (ref) => workspace.offref(ref),
    }),
  });

  const stack = new AsyncDisposableStack();
  const { services } = new ServiceContainer(stack, () => undefined)
    .useValue({
      noteIndex: () =>
        buildNoteIndex(
          {
            vault: app.vault,
            metadataCache: app.metadataCache,
            workspace: app.workspace,
          },
          stack,
        ),
    })
    .use({ newer: ({ noteIndex }) => new ReadsOnTeardown(noteIndex) });
  expect(vault.listened().sort()).toEqual([
    "create",
    "delete",
    "modify",
    "rename",
  ]);
  // The Vault tag's one listener per name; the Note Index adds none of its own.
  expect([...vault.listeners.values()].map((set) => set.size)).toEqual([
    1, 1, 1, 1,
  ]);
  expect(metadataCache.listened().sort()).toEqual([
    "changed",
    "deleted",
    "resolve",
    "resolved",
  ]);

  const disposed = stack.disposeAsync();
  await services.newer.started.promise;
  await delay(20);
  expect(vault.listened().sort()).toEqual([
    "create",
    "delete",
    "modify",
    "rename",
  ]);
  expect(metadataCache.listened().sort()).toEqual([
    "changed",
    "deleted",
    "resolve",
    "resolved",
  ]);

  services.newer.finish();
  await disposed;
  expect(vault.listened()).toEqual([]);
  expect(metadataCache.listened()).toEqual([]);
});
