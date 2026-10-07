import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { Library } from "@zotlit/db";

import { QueryClientService } from "@/services/query-client/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import type { LibraryScope, ResolvedLibraryScope } from "./scope";
import { LIBRARY_SCOPE_KEY, LibraryScopeService } from "./service";

/**
 * Local library ids run against group-id order — group 200 sits at libraryID 3
 * and group 100 at libraryID 7 — so a canonical-order assertion cannot pass on
 * database row order.
 */
const MY_LIBRARY: Library = {
  libraryID: 1,
  version: 0,
  clientVersion: null,
  type: "user",
  groupID: null,
  name: null,
};
const GROUP_200: Library = {
  libraryID: 3,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 200,
  name: "Shared B",
};
const GROUP_100: Library = {
  libraryID: 7,
  version: 0,
  clientVersion: null,
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
    await using f = await makeService();

    const before = f.librariesRead;

    await f.refresh([MY_LIBRARY, GROUP_200, GROUP_100]);
    await expect.poll(() => f.librariesRead).toBeGreaterThan(before);
    await f.service.ready;

    expect(f.changed).not.toHaveBeenCalled();
  });

  it("emits a change when a group is renamed", async () => {
    await using f = await makeService();
    const { changed } = f;

    await f.refresh([MY_LIBRARY, GROUP_200, { ...GROUP_100, name: "Renamed" }]);

    await expect.poll(() => changed.mock.calls).toHaveLength(1);
    expect(changed.mock.lastCall?.[0]?.available[1]).toMatchObject({
      name: "Renamed",
    });
  });

  it("gives a returning group its current local library id", async () => {
    await using f = await makeService({
      libraries: [MY_LIBRARY],
      scope: {
        mode: "selected",
        libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
      },
    });
    const { service, changed } = f;

    expect(service.current?.unavailable).toEqual([
      { type: "group", groupID: 100 },
    ]);

    await f.refresh([MY_LIBRARY, { ...GROUP_100, libraryID: 11 }]);

    await expect.poll(() => service.current?.unavailable).toEqual([]);
    expect(service.current?.available[1]).toMatchObject({ libraryID: 11 });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("reports no scope at all while the database is unreadable", async () => {
    await using f = await makeService({ libraries: null });

    expect(f.service.current).toBeNull();
    expect(f.service.libraries).toEqual([]);
  });

  it("keeps the previous scope while a fresh read of the Libraries runs", async () => {
    await using f = await makeService();
    const before = f.service.current;
    const gate = f.gateLibraries();

    await f.refresh([MY_LIBRARY]);
    await expect.poll(() => gate.waiting).toBe(true);

    expect(f.service.current).toBe(before);
    gate.release();
    await expect.poll(() => f.service.current?.available).toHaveLength(1);
  });

  it("keeps the previous scope when a Libraries read fails, and asks again after the failure cooldown", async () => {
    await using f = await makeService();
    const before = f.service.current;
    f.failLibraries(true);

    await f.refresh([MY_LIBRARY]);
    await f.service.ready;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(f.service.current).toBe(before);
    f.failLibraries(false);
    f.advance(10);
    expect(f.service.current).toBe(before);
    await expect.poll(() => f.service.current?.available).toHaveLength(1);
  });

  it("keeps the previous scope when a refresh fails", async () => {
    await using f = await makeService();
    const before = f.service.current;

    await f.refresh(null);

    expect(f.service.current).toBe(before);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it("separates an unreadable database from a scope with no library", async () => {
    await using f = await makeService({ libraries: [] });

    expect(f.service.current).toEqual({
      mode: "all",
      invalid: false,
      available: [],
      unavailable: [],
    });
  });

  it("falls back to my library while the saved value is broken", async () => {
    await using f = await makeService({ scope: null, broken: true });
    const { service } = f;

    expect(service.invalid).toBe(true);
    expect(service.current).toMatchObject({
      mode: "selected",
      invalid: true,
      available: [{ selector: { type: "personal" }, libraryID: 1 }],
    });
  });

  it("emits a change when a repair clears the broken value", async () => {
    await using f = await makeService({ scope: null, broken: true });
    const { settings, service, changed } = f;

    settings.repair({ mode: "all" });

    expect(service.invalid).toBe(false);
    expect(service.current).toMatchObject({ mode: "all", invalid: false });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("emits a change when the user saves a different scope", async () => {
    await using f = await makeService();
    const { settings, service, changed } = f;

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

  it("resolves against a caller-pinned client rather than the held Libraries", async () => {
    await using f = await makeService({
      loadLibraries: () => [MY_LIBRARY, GROUP_200, GROUP_100],
    });

    await f.refresh([MY_LIBRARY]);
    await expect.poll(() => f.service.current?.available).toHaveLength(1);

    expect(f.service.resolveWith({} as never).available).toHaveLength(3);
  });
});

/** The rows one database open holds; `null` fails that open. */
function librariesSql(libraries: readonly Library[] | null): string | null {
  if (libraries === null) return null;
  return libraries
    .map(
      (library) =>
        `insert into libraries (libraryID, type) values (${library.libraryID}, '${library.type}');${
          library.groupID === null
            ? ""
            : `insert into groups (groupID, libraryID, name) values (${library.groupID}, ${library.libraryID}, '${library.name}');`
        }`,
    )
    .join("\n");
}

async function makeService(
  options: {
    libraries?: readonly Library[] | null;
    scope?: LibraryScope | null;
    broken?: boolean;
    loadLibraries?: () => Library[];
  } = {},
) {
  const stack = new AsyncDisposableStack();
  /** What each open of the database holds, in open order. */
  const opens: (readonly Library[] | null)[] = [
    options.libraries === undefined
      ? [MY_LIBRARY, GROUP_200, GROUP_100]
      : options.libraries,
  ];
  let gate: PromiseWithResolvers<void> | null = null;
  let waiting = false;
  let librariesRead = 0;
  let failing = false;
  let now = Temporal.Now.instant();
  const { open } = memoryOpener((n) => librariesSql(opens[n - 1] ?? null));
  const reads = stack.use(
    inProcessReadsService(open, (client) => ({
      ...client,
      Libraries: ((...args: Parameters<typeof client.Libraries>) =>
        Effect.andThen(
          Effect.andThen(
            Effect.promise(async () => {
              if (gate === null) return;
              waiting = true;
              await gate.promise;
            }),
            () =>
              failing
                ? Effect.fail(new DbUnavailable({ message: "the read failed" }))
                : Effect.void,
          ),
          Effect.map(client.Libraries(...args), (libraries) => {
            librariesRead += 1;
            return libraries;
          }),
        )) as typeof client.Libraries,
    })),
  );
  const queries = stack.use(new QueryClientService({ now: () => now }));
  const settings = new FakeSettings(
    options.scope === undefined ? { mode: "all" } : options.scope,
    options.broken ?? false,
  );
  const service = stack.use(
    new LibraryScopeService({
      reads,
      queries,
      settings: settings as unknown as SettingsService,
      ...(options.loadLibraries && { loadLibraries: options.loadLibraries }),
    }),
  );
  await service.ready;
  // Subscribed after startup, so every assertion counts only what the test did.
  const changed = vi.fn<(scope: ResolvedLibraryScope | null) => void>();
  service.on("changed", changed);
  return {
    service,
    settings,
    changed,
    /** How many `Libraries` reads have answered. */
    get librariesRead() {
      return librariesRead;
    },
    /** A database refresh onto a source holding `libraries`; `null` fails it. */
    refresh: async (libraries: readonly Library[] | null) => {
      opens.push(libraries);
      await reads.refresh().catch(() => {});
    },
    /** Makes every later `Libraries` read fail, until set back. */
    failLibraries: (on: boolean) => {
      failing = on;
    },
    /** Moves the failure cooldown clock forward from the real time. */
    advance: (seconds: number) => {
      now = now.add({ seconds });
    },
    /** Holds every later `Libraries` read until `release`. */
    gateLibraries: () => {
      const held = Promise.withResolvers<void>();
      gate = held;
      return {
        get waiting() {
          return waiting;
        },
        release: () => held.resolve(),
      };
    },
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
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
