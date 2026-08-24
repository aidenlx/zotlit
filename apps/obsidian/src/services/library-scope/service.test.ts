import { describe, expect, it, vi } from "vitest";

import type { Library } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import type { DatabaseService } from "@/services/database/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type { LibraryScope, ResolvedLibraryScope } from "./scope";
import { LIBRARY_SCOPE_KEY, LibraryScopeService } from "./service";

/**
 * Local library ids run against group-id order — group 200 sits at libraryID 3
 * and group 100 at libraryID 7 — so a canonical-order assertion cannot pass on
 * database row order.
 */
const MY_LIBRARY: Library = {
  libraryID: 1,
  type: "user",
  groupID: null,
  name: null,
};
const GROUP_200: Library = {
  libraryID: 3,
  type: "group",
  groupID: 200,
  name: "Shared B",
};
const GROUP_100: Library = {
  libraryID: 7,
  type: "group",
  groupID: 100,
  name: "Shared A",
};

describe("LibraryScopeService", () => {
  it("resolves the saved scope once the database is ready", async () => {
    const { service } = await makeService();

    expect(service.current).toMatchObject({
      mode: "all",
      invalid: false,
      available: [
        { selector: { type: "personal" }, libraryID: 1, name: null },
        { selector: { type: "group", groupID: 100 }, libraryID: 7 },
        { selector: { type: "group", groupID: 200 }, libraryID: 3 },
      ],
    });
  });

  it("emits nothing for a refresh that finds the same libraries", async () => {
    const { db, changed } = await makeService();

    db.emit("changed");

    expect(changed).not.toHaveBeenCalled();
  });

  it("emits a change when a group is renamed", async () => {
    const { db, changed } = await makeService();

    db.setLibraries([MY_LIBRARY, GROUP_200, { ...GROUP_100, name: "Renamed" }]);

    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.lastCall?.[0]?.available[1]).toMatchObject({
      name: "Renamed",
    });
  });

  it("gives a returning group its current local library id", async () => {
    const { db, service, changed } = await makeService({
      libraries: [MY_LIBRARY],
      scope: {
        mode: "selected",
        libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
      },
    });

    expect(service.current?.unavailable).toEqual([
      { type: "group", groupID: 100 },
    ]);

    db.setLibraries([MY_LIBRARY, { ...GROUP_100, libraryID: 11 }]);

    expect(service.current?.unavailable).toEqual([]);
    expect(service.current?.available[1]).toMatchObject({ libraryID: 11 });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("reports no scope at all while the database is unreadable", async () => {
    const { db, service, changed } = await makeService();

    db.degrade();

    expect(service.current).toBeNull();
    expect(changed).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("separates an unreadable database from a scope with no library", async () => {
    const { service } = await makeService({ libraries: [] });

    expect(service.current).toEqual({
      mode: "all",
      invalid: false,
      available: [],
      unavailable: [],
    });
  });

  it("falls back to my library while the saved value is broken", async () => {
    const { service } = await makeService({ scope: null, broken: true });

    expect(service.invalid).toBe(true);
    expect(service.current).toMatchObject({
      mode: "selected",
      invalid: true,
      available: [{ selector: { type: "personal" }, libraryID: 1 }],
    });
  });

  it("emits a change when a repair clears the broken value", async () => {
    const { settings, service, changed } = await makeService({
      scope: null,
      broken: true,
    });

    settings.repair({ mode: "all" });

    expect(service.invalid).toBe(false);
    expect(service.current).toMatchObject({ mode: "all", invalid: false });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("emits a change when the user saves a different scope", async () => {
    const { settings, service, changed } = await makeService();

    settings.set({
      mode: "selected",
      libraries: [{ type: "group", groupID: 200 }],
    });

    expect(service.current?.available).toEqual([
      {
        selector: { type: "group", groupID: 200 },
        libraryID: 3,
        name: "Shared B",
      },
    ]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("resolves against a caller-pinned client rather than the live one", async () => {
    const { db, service } = await makeService();
    const pinned = db.client;

    db.setLibraries([MY_LIBRARY]);

    expect(service.resolveWith(pinned).available).toHaveLength(3);
    expect(service.current?.available).toHaveLength(1);
  });
});

async function makeService(
  options: {
    libraries?: readonly Library[];
    scope?: LibraryScope | null;
    broken?: boolean;
  } = {},
): Promise<{
  db: FakeDb;
  settings: FakeSettings;
  service: LibraryScopeService;
  changed: ReturnType<
    typeof vi.fn<(scope: ResolvedLibraryScope | null) => void>
  >;
}> {
  const db = new FakeDb(
    options.libraries ?? [MY_LIBRARY, GROUP_200, GROUP_100],
  );
  const settings = new FakeSettings(
    options.scope === undefined ? { mode: "all" } : options.scope,
    options.broken ?? false,
  );
  const service = new LibraryScopeService({
    db: db as unknown as DatabaseService,
    settings: settings as unknown as SettingsService,
    loadLibraries: (client) => db.librariesOf(client),
  });
  await service.ready;
  // Subscribed after startup, so every assertion counts only what the test did.
  const changed = vi.fn<(scope: ResolvedLibraryScope | null) => void>();
  service.on("changed", changed);
  return { db, settings, service, changed };
}

/** A snapshot of Libraries, pinned per client so a lease can outlive a change. */
class FakeDb {
  #client: NodeDatabaseClient;
  #degraded = false;
  readonly #libraries = new Map<NodeDatabaseClient, readonly Library[]>();
  readonly #listeners = new Map<string, Set<() => void>>();

  readonly ready = Promise.resolve();

  constructor(libraries: readonly Library[]) {
    this.#client = {} as NodeDatabaseClient;
    this.#libraries.set(this.#client, libraries);
  }

  get state(): "ready" | "degraded" {
    return this.#degraded ? "degraded" : "ready";
  }

  get client(): NodeDatabaseClient {
    return this.#client;
  }

  librariesOf(client: NodeDatabaseClient): Library[] {
    return [...(this.#libraries.get(client) ?? [])];
  }

  on(event: "changed" | "degraded", cb: () => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(cb);
    this.#listeners.set(event, listeners);
    return () => {
      listeners.delete(cb);
    };
  }

  emit(event: "changed" | "degraded"): void {
    for (const cb of this.#listeners.get(event) ?? []) cb();
  }

  /** A refresh onto a fresh client, the way a real reopen swaps the snapshot. */
  setLibraries(libraries: readonly Library[]): void {
    this.#client = {} as NodeDatabaseClient;
    this.#libraries.set(this.#client, libraries);
    this.emit("changed");
  }

  degrade(): void {
    this.#degraded = true;
    this.emit("degraded");
  }
}

class FakeSettings {
  #scope: LibraryScope | null;
  #broken: boolean;
  readonly #subscribers = new Set<(value: Readonly<Settings> | null) => void>();

  constructor(scope: LibraryScope | null, broken: boolean) {
    this.#scope = scope;
    this.#broken = broken;
  }

  get current(): Readonly<Settings> {
    return { [LIBRARY_SCOPE_KEY]: this.#scope } as unknown as Settings;
  }

  get loaded(): Promise<Readonly<Settings>> {
    return Promise.resolve(this.current);
  }

  get diagnostics(): readonly { key: string; value: unknown }[] {
    return this.#broken ? [{ key: LIBRARY_SCOPE_KEY, value: "nonsense" }] : [];
  }

  subscribe(cb: (value: Readonly<Settings> | null) => void): () => void {
    this.#subscribers.add(cb);
    cb(this.current);
    return () => {
      this.#subscribers.delete(cb);
    };
  }

  set(scope: LibraryScope): void {
    this.#scope = scope;
    this.#notify();
  }

  /** The first valid edit replaces the broken value and clears its diagnostic. */
  repair(scope: LibraryScope): void {
    this.#broken = false;
    this.set(scope);
  }

  #notify(): void {
    for (const cb of this.#subscribers) cb(this.current);
  }
}
