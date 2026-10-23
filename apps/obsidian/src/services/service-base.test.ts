import { delay } from "@std/async";
import type { App, EventRef } from "obsidian";
import { expect, it, vi } from "vitest";

import { buildNoteIndex } from "./note-index/__fixtures__";
import type { PlainNoteIndex } from "./note-index/plain";
import { Service, ServiceContainer } from "./service-base";

vi.mock("@/lib/log", () => ({
  getLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

type Callback = (...args: unknown[]) => void;

/** Obsidian's `Events`: a listener list per event name, cut by `offref`. */
class FakeEvents {
  readonly listeners = new Map<string, Set<Callback>>();

  on(name: string, callback: Callback): EventRef {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
    return { e: this, name, callback } as unknown as EventRef;
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
  const app = {
    vault,
    metadataCache,
    workspace: { onLayoutReady: () => undefined },
  } as unknown as App;

  const stack = new AsyncDisposableStack();
  const { services } = new ServiceContainer(stack, () => undefined)
    .useValue({ noteIndex: () => buildNoteIndex(app, stack) })
    .use({ newer: ({ noteIndex }) => new ReadsOnTeardown(noteIndex) });
  expect(vault.listened().sort()).toEqual(["delete", "rename"]);
  expect(metadataCache.listened().sort()).toEqual(["changed", "deleted"]);

  const disposed = stack.disposeAsync();
  await services.newer.started.promise;
  await delay(20);
  expect(vault.listened().sort()).toEqual(["delete", "rename"]);
  expect(metadataCache.listened().sort()).toEqual(["changed", "deleted"]);

  services.newer.finish();
  await disposed;
  expect(vault.listened()).toEqual([]);
  expect(metadataCache.listened()).toEqual([]);
});
