/**
 * Tests for `DatabaseService`. Each test owns a fresh temp dir + a fresh
 * `SettingsService` whose `data.json` points at that dir. `@zotlit/db`'s
 * `createClient` is mocked so we control success/failure and capture
 * URI arguments. `node:fs.watch` is mocked with a controllable fake so we
 * can drive watcher events deterministically (real FSEvents on macOS would
 * make the suite flaky).
 */

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@zotlit/db/client/node", () => ({
  createClient: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, watch: vi.fn() };
});

import { watch } from "node:fs";

import { createClient } from "@zotlit/db/client/node";

import { SettingsService } from "@/services/settings/service";

import { DatabaseError, type DbEvents, DatabaseService } from "./service";

const createClientMock = vi.mocked(createClient);
const watchMock = vi.mocked(watch);

class FakeWatcher extends EventEmitter {
  closed = false;
  constructor(
    /** The first arg to `watch()` — either the dir path or the file path. */
    readonly target: string,
    readonly listener: (event: string, filename: string | null) => void,
  ) {
    super();
  }
  close(): void {
    this.closed = true;
  }
  fire(filename: string | null = "zotero.sqlite", event = "change"): void {
    if (this.closed) return;
    this.listener(event, filename);
  }
}

const activeWatchers: FakeWatcher[] = [];

function setupWatchMock(): void {
  // `watch` has multiple overloads. Use a permissive cast so the mocked
  // signature accepts the (target, options, listener) shape the service uses.
  const impl = (
    target: string,
    _options: unknown,
    listener: (event: string, filename: string | null) => void,
  ) => {
    const w = new FakeWatcher(target, listener);
    activeWatchers.push(w);
    return w as unknown as ReturnType<typeof watch>;
  };
  watchMock.mockImplementation(impl as never);
}

function liveWatchers(): FakeWatcher[] {
  return activeWatchers.filter((w) => !w.closed);
}

/** Find the live dir-level watcher (watches the parent dir). */
function liveDirWatcher(dir: string): FakeWatcher | undefined {
  return liveWatchers().find((w) => w.target === dir);
}

/** Find the live file-level watcher (watches the sqlite file path). */
function liveFileWatcher(file: string): FakeWatcher | undefined {
  return liveWatchers().find((w) => w.target === file);
}

class PluginStub {
  __data: unknown;
  constructor(initial: unknown = null) {
    this.__data = initial;
  }
  loadData(): Promise<unknown> {
    return Promise.resolve(this.__data);
  }
  async saveData(data: unknown): Promise<void> {
    this.__data = data;
  }
}

interface FakeClient {
  $client: { close: ReturnType<typeof vi.fn> };
}

function makeFakeClient(): FakeClient {
  return { $client: { close: vi.fn() } };
}

let tmpRoot: string;
let dataDir: string;
let dbPath: string;

/**
 * Yield to libuv so real fs I/O callbacks (stat, etc.) fire. Microtasks alone
 * aren't enough: only setTimeout/clearTimeout are faked here.
 */
async function flush(iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  maxIterations = 50,
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

async function makeService(options?: {
  initialData?: Record<string, unknown>;
}): Promise<{
  plugin: PluginStub;
  settings: SettingsService;
  service: DatabaseService;
}> {
  const persisted = {
    __VERSION__: 1,
    "zotero.data-dir": dataDir,
    ...options?.initialData,
  };
  const plugin = new PluginStub(persisted);
  const settings = new SettingsService({
    plugin,
    migrateLegacy: (raw) => raw,
  });
  await settings.ready;
  const service = new DatabaseService({ settings });
  await service.ready;
  return { plugin, settings, service };
}

function listen<K extends keyof DbEvents>(
  service: DatabaseService,
  event: K,
): { count: number; calls: Parameters<DbEvents[K]>[] } {
  const record = { count: 0, calls: [] as Parameters<DbEvents[K]>[] };
  service.on(event, ((...args: Parameters<DbEvents[K]>) => {
    record.count++;
    record.calls.push(args);
  }) as DbEvents[K]);
  return record;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  createClientMock.mockReset();
  watchMock.mockReset();
  activeWatchers.length = 0;
  setupWatchMock();

  tmpRoot = await mkdtemp(join(tmpdir(), "zotlit-db-"));
  dataDir = join(tmpRoot, "data");
  // Create data dir + initial sqlite file so fs.stat succeeds.
  await mkdir(dataDir, { recursive: true });
  dbPath = join(dataDir, "zotero.sqlite");
  await writeFile(dbPath, "init");
  // Default: createClient returns a fresh fake client per call.
  createClientMock.mockImplementation(() => makeFakeClient() as never);
});

afterEach(async () => {
  vi.useRealTimers();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("DatabaseService — startup", () => {
  it("T1: happy path — ready, state=ready, db() returns client, no changed event", async () => {
    const { service } = await makeService();
    const changed = listen(service, "changed");

    expect(service.state).toBe("ready");
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      expect.stringContaining("mode=ro&immutable=1"),
      expect.anything(),
    );
    expect(service.client).toBeDefined();
    expect(changed.count).toBe(0);

    await service[Symbol.asyncDispose]();
  });

  it("T1: uses pathToFileURL — handles spaces in path", async () => {
    const { service } = await makeService();
    const url = createClientMock.mock.calls[0]![0] as string;
    expect(url).toBe(`${pathToFileURL(dbPath).toString()}?mode=ro&immutable=1`);
    await service[Symbol.asyncDispose]();
  });

  it("T2: startup failure — ready resolves, state=degraded, db() throws", async () => {
    const openError = new Error("open failed");
    createClientMock.mockImplementationOnce(() => {
      throw openError;
    });

    const { service } = await makeService();
    expect(service.state).toBe("degraded");
    expect(() => service.client).toThrow(DatabaseError);
    try {
      void service.client;
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).code).toBe("degraded");
      expect((err as DatabaseError).cause).toBe(openError);
    }

    await service[Symbol.asyncDispose]();
  });

  it("T2b: startup failure recovers on settings change", async () => {
    const openError = new Error("nope");
    createClientMock.mockImplementationOnce(() => {
      throw openError;
    });
    const { settings, service } = await makeService();
    expect(service.state).toBe("degraded");

    const changed = listen(service, "changed");
    createClientMock.mockImplementation(() => makeFakeClient() as never);

    // Switch data-dir to a fresh path to trigger #scheduleRefresh.
    const altDir = join(tmpRoot, "alt");
    await mkdir(altDir);
    await writeFile(join(altDir, "zotero.sqlite"), "alt");
    settings.update({ "zotero.data-dir": altDir });
    await waitFor(() => service.state === "ready", "recover to ready");

    expect(service.state).toBe("ready");
    expect(changed.count).toBe(1);

    await service[Symbol.asyncDispose]();
  });
});

describe("DatabaseService — refresh", () => {
  it("T3: same-path refresh failure preserves old client", async () => {
    const { service } = await makeService();
    const original = service.client as unknown as FakeClient;
    const degraded = listen(service, "degraded");

    createClientMock.mockImplementationOnce(() => {
      throw new Error("transient");
    });
    await expect(service.refresh()).resolves.toBeUndefined();

    expect(service.state).toBe("ready");
    expect(service.client).toBe(original as never);
    expect(original.$client.close).not.toHaveBeenCalled();
    expect(degraded.count).toBe(0);

    await service[Symbol.asyncDispose]();
  });

  it("T4: data-dir hot switch failure degrades immediately", async () => {
    const { settings, service } = await makeService();
    const original = service.client as unknown as FakeClient;
    const degraded = listen(service, "degraded");

    const altDir = join(tmpRoot, "alt");
    await mkdir(altDir);
    await writeFile(join(altDir, "zotero.sqlite"), "alt");
    const openError = new Error("alt open failed");
    createClientMock.mockImplementation(() => {
      throw openError;
    });

    settings.update({ "zotero.data-dir": altDir });
    await waitFor(() => service.state === "degraded", "settle to degraded");

    expect(service.state).toBe("degraded");
    expect(original.$client.close).toHaveBeenCalledTimes(1);
    expect(degraded.count).toBe(1);
    expect(degraded.calls[0]![0]).toBeInstanceOf(DatabaseError);
    expect(degraded.calls[0]![0]!.cause).toBe(openError);
    // Watcher stopped — subsequent fs events shouldn't reach the service.
    expect(liveWatchers()).toHaveLength(0);

    await service[Symbol.asyncDispose]();
  });

  it("T5: watcher debounce collapses bursts into one createClient call", async () => {
    const { service } = await makeService();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [watcher] = liveWatchers();
    expect(watcher).toBeDefined();

    for (let i = 0; i < 5; i++) watcher!.fire();
    expect(createClientMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(2);

    await service[Symbol.asyncDispose]();
  });

  it("T6: settings hot switch happy path", async () => {
    const { settings, service } = await makeService();
    const firstClient = service.client as unknown as FakeClient;
    const changed = listen(service, "changed");

    const altDir = join(tmpRoot, "alt");
    await mkdir(altDir);
    const altDbPath = join(altDir, "zotero.sqlite");
    await writeFile(altDbPath, "alt");

    settings.update({ "zotero.data-dir": altDir });
    await waitFor(
      () => (service.client as unknown as FakeClient) !== firstClient,
      "swap to new client",
    );

    expect(service.state).toBe("ready");
    expect(service.client).not.toBe(firstClient as never);
    expect(firstClient.$client.close).toHaveBeenCalledTimes(1);
    expect(changed.count).toBe(1);
    // Both watchers rebound to the alt location.
    expect(liveWatchers()).toHaveLength(2);
    expect(liveDirWatcher(altDir)).toBeDefined();
    expect(liveFileWatcher(altDbPath)).toBeDefined();

    await service[Symbol.asyncDispose]();
  });

  it("T8: manual refresh recovers from degraded", async () => {
    createClientMock.mockImplementationOnce(() => {
      throw new Error("first");
    });
    const { service } = await makeService();
    expect(service.state).toBe("degraded");

    const changed = listen(service, "changed");
    await expect(service.refresh()).resolves.toBeUndefined();

    expect(service.state).toBe("ready");
    expect(changed.count).toBe(1);

    await service[Symbol.asyncDispose]();
  });

  it("T9: dirty-flag trailing rerun — in-flight + extra triggers collapse to one extra call", async () => {
    const { service } = await makeService();
    expect(createClientMock).toHaveBeenCalledTimes(1);

    // Issue all triggers synchronously: p1 starts the in-flight refresh (one
    // createClient call); p2-p4 just set #refreshPending. After the in-flight
    // resolves, exactly one trailing rerun fires.
    const p1 = service.refresh();
    const p2 = service.refresh();
    const p3 = service.refresh();
    const p4 = service.refresh();
    await Promise.all([p1, p2, p3, p4]);

    // 1 initial open + 1 in-flight refresh + 1 trailing rerun = 3.
    expect(createClientMock).toHaveBeenCalledTimes(3);

    await service[Symbol.asyncDispose]();
  });

  it("T10: refresh() drain terminates with concurrent callers", async () => {
    const { service } = await makeService();
    const [a, b] = [service.refresh(), service.refresh()];
    await Promise.all([a, b]);
    expect(service.state).toBe("ready");

    await service[Symbol.asyncDispose]();
  });
});

describe("DatabaseService — isUpToDate", () => {
  it("T11: throws not-ready while loading", async () => {
    const persisted = {
      __VERSION__: 1,
      "zotero.data-dir": dataDir,
    };
    const plugin = new PluginStub(persisted);
    const settings = new SettingsService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    const service = new DatabaseService({ settings });
    await expect(service.isUpToDate()).rejects.toMatchObject({
      code: "not-ready",
    });
    await settings.ready;
    await service.ready;
    await service[Symbol.asyncDispose]();
  });

  it("T11: throws degraded when degraded", async () => {
    createClientMock.mockImplementationOnce(() => {
      throw new Error("nope");
    });
    const { service } = await makeService();
    await expect(service.isUpToDate()).rejects.toMatchObject({
      code: "degraded",
    });
    await service[Symbol.asyncDispose]();
  });

  it("T11: true when (mtime, size) matches the open-time tuple", async () => {
    const { service } = await makeService();
    await expect(service.isUpToDate()).resolves.toBe(true);
    await service[Symbol.asyncDispose]();
  });

  it("T11: false when mtime bumps (size preserved)", async () => {
    const { service } = await makeService();
    const before = await stat(dbPath);
    // utimes gives us a deterministic mtime bump without writing — proves
    // the mtime axis works in isolation from size.
    const bumpedMs = before.mtimeMs + 5_000;
    const bumped = new Date(bumpedMs);
    await utimes(dbPath, bumped, bumped);
    const after = await stat(dbPath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).not.toBe(before.mtimeMs);

    await expect(service.isUpToDate()).resolves.toBe(false);

    await service[Symbol.asyncDispose]();
  });

  it("T11: false when size changes (covers the rsync -t / cloud-sync axis)", async () => {
    const { service } = await makeService();
    const before = await stat(dbPath);
    await writeFile(dbPath, "much longer payload than before");
    const after = await stat(dbPath);
    expect(after.size).not.toBe(before.size);

    await expect(service.isUpToDate()).resolves.toBe(false);

    await service[Symbol.asyncDispose]();
  });

  it("T11: false during in-flight hot switch (#activePath !== #lastDbPath)", async () => {
    const { settings, service } = await makeService();
    const altDir = join(tmpRoot, "alt");
    await mkdir(altDir);
    await writeFile(join(altDir, "zotero.sqlite"), "alt");

    // Mutating settings updates #lastDbPath synchronously inside
    // #onSettingsChanged, but #activePath only swaps when #runRefresh
    // succeeds. Check before draining.
    settings.update({ "zotero.data-dir": altDir });
    await expect(service.isUpToDate()).resolves.toBe(false);
    await service.refresh();

    await service[Symbol.asyncDispose]();
  });
});

describe("DatabaseService — watcher lifecycle", () => {
  it("T12: auto-refresh toggle stops and rebinds the watcher pair", async () => {
    const { settings, service } = await makeService();
    expect(liveWatchers()).toHaveLength(2);
    expect(liveDirWatcher(dataDir)).toBeDefined();
    expect(liveFileWatcher(dbPath)).toBeDefined();

    settings.update({ "zotero.auto-refresh": false });
    await flush();
    expect(liveWatchers()).toHaveLength(0);

    settings.update({ "zotero.auto-refresh": true });
    await flush();
    expect(liveWatchers()).toHaveLength(2);
    expect(liveDirWatcher(dataDir)).toBeDefined();
    expect(liveFileWatcher(dbPath)).toBeDefined();

    // Watcher fires after rebind — pick either; they share the debounce.
    liveDirWatcher(dataDir)!.fire();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(2);

    await service[Symbol.asyncDispose]();
  });

  it.each([
    { source: "dir" as const, pickWatcher: () => liveDirWatcher(dataDir)! },
    { source: "file" as const, pickWatcher: () => liveFileWatcher(dbPath)! },
  ])("T13: watcher self-heals on '$source' error", async ({ pickWatcher }) => {
    const { service } = await makeService();
    expect(liveWatchers()).toHaveLength(2);
    const prePair = liveWatchers().slice();
    const targeted = pickWatcher();
    const beforeCalls = createClientMock.mock.calls.length;

    targeted.emit("error", new Error("boom"));
    await waitFor(
      () => createClientMock.mock.calls.length > beforeCalls,
      "refresh after watcher error",
    );
    await waitFor(
      () =>
        liveWatchers().length === 2 &&
        prePair.every((w) => !liveWatchers().includes(w)),
      "both watchers rebound",
    );

    // After self-heal: a fresh pair. The non-errored sibling must also be torn
    // down (#stopWatcher closes the whole pair), not left dangling alongside
    // the rebound ones.
    const live = liveWatchers();
    expect(live).toHaveLength(2);
    for (const old of prePair) {
      expect(old.closed).toBe(true);
      expect(live).not.toContain(old);
    }
    expect(liveDirWatcher(dataDir)).toBeDefined();
    expect(liveFileWatcher(dbPath)).toBeDefined();

    // Subsequent fire on the rebound pair triggers another refresh.
    const after = createClientMock.mock.calls.length;
    liveDirWatcher(dataDir)!.fire();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(createClientMock.mock.calls.length).toBeGreaterThan(after);

    await service[Symbol.asyncDispose]();
  });

  it("T15: dual-watch coverage — each watch independently triggers a refresh; both within window coalesce", async () => {
    const { service } = await makeService();
    expect(liveWatchers()).toHaveLength(2);

    // File-only event triggers exactly one refresh.
    liveFileWatcher(dbPath)!.fire();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(2);

    // Dir-only event (on the freshly-rebound pair) triggers exactly one more.
    liveDirWatcher(dataDir)!.fire();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(3);

    // Both within the same debounce window coalesce into a single refresh.
    liveDirWatcher(dataDir)!.fire();
    liveFileWatcher(dbPath)!.fire();
    liveDirWatcher(dataDir)!.fire();
    liveFileWatcher(dbPath)!.fire();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(4);

    await service[Symbol.asyncDispose]();
  });

  it("T16: rollback when file-watch creation throws — dir watch is closed, no live watcher remains", async () => {
    // Rig watch() so the dir-level call succeeds and the file-level call
    // throws. #startWatcher must roll back the dir watcher; the service
    // should still reach "ready" (the watcher pair is best-effort) with
    // zero live watchers.
    let callCount = 0;
    watchMock.mockImplementation(((
      target: string,
      _opts: unknown,
      listener: (event: string, filename: string | null) => void,
    ) => {
      callCount += 1;
      // Dir watch is opened first; file watch second.
      if (callCount === 2) throw new Error("file watch failed");
      const w = new FakeWatcher(target, listener);
      activeWatchers.push(w);
      return w as unknown as ReturnType<typeof watch>;
    }) as never);

    const { service } = await makeService();
    expect(service.state).toBe("ready");
    // Dir was created then rolled back; file throw never produced a watcher.
    expect(activeWatchers).toHaveLength(1);
    expect(activeWatchers[0]!.target).toBe(dataDir);
    expect(activeWatchers[0]!.closed).toBe(true);
    expect(liveWatchers()).toHaveLength(0);

    await service[Symbol.asyncDispose]();
  });
});

describe("DatabaseService — disposal", () => {
  it("T7: dispose closes client, stops watcher, unsubscribes from settings", async () => {
    const { settings, service } = await makeService();
    const client = service.client as unknown as FakeClient;
    const firstWatcher = liveWatchers()[0]!;

    await service[Symbol.asyncDispose]();
    expect(client.$client.close).toHaveBeenCalledTimes(1);
    expect(firstWatcher.closed).toBe(true);

    // Settings change after dispose: no new createClient calls (no refresh).
    const before = createClientMock.mock.calls.length;
    settings.update({ "zotero.data-dir": join(tmpRoot, "alt") });
    await flush();
    expect(createClientMock).toHaveBeenCalledTimes(before);
  });

  it("T7: dispose is safe on never-succeeded service", async () => {
    createClientMock.mockImplementationOnce(() => {
      throw new Error("never");
    });
    const { service } = await makeService();
    expect(service.state).toBe("degraded");
    await expect(service[Symbol.asyncDispose]()).resolves.toBeUndefined();
  });

  it("dispose drains in-flight refresh and closes any client it installed", async () => {
    const { service } = await makeService();
    const firstClient = service.client as unknown as FakeClient;

    // Start a refresh, then dispose before its trailing-rerun chain ends.
    const refreshPromise = service.refresh();
    const disposePromise = service[Symbol.asyncDispose]();
    await Promise.all([refreshPromise.catch(() => undefined), disposePromise]);

    // Every fake client ever returned must be closed exactly once.
    const calls = createClientMock.mock.results;
    for (const result of calls) {
      const client = result.value as FakeClient;
      expect(client.$client.close).toHaveBeenCalledTimes(1);
    }
    expect(firstClient.$client.close).toHaveBeenCalledTimes(1);
    // No live watcher leaks after disposal.
    expect(liveWatchers()).toHaveLength(0);
  });
});

describe("DatabaseService — leak on post-open fs.stat failure", () => {
  it("closes the freshly-opened client when fs.stat throws in #load", async () => {
    // Point settings at a non-existent path so stat fails after createClient
    // succeeds.
    const missingDir = join(tmpRoot, "ghost");
    const persisted = {
      __VERSION__: 1,
      "zotero.data-dir": missingDir,
    };
    const plugin = new PluginStub(persisted);
    const settings = new SettingsService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await settings.ready;

    const fakeClients: FakeClient[] = [];
    createClientMock.mockImplementation(() => {
      const c = makeFakeClient();
      fakeClients.push(c);
      return c as never;
    });

    const service = new DatabaseService({ settings });
    await service.ready;
    expect(service.state).toBe("degraded");
    expect(fakeClients).toHaveLength(1);
    expect(fakeClients[0]!.$client.close).toHaveBeenCalledTimes(1);

    await service[Symbol.asyncDispose]();
  });

  it("closes the freshly-opened client when fs.stat throws in #runRefresh", async () => {
    const { settings, service } = await makeService();
    const firstClient = service.client as unknown as FakeClient;

    const fakeClients: FakeClient[] = [];
    createClientMock.mockImplementation(() => {
      const c = makeFakeClient();
      fakeClients.push(c);
      return c as never;
    });

    // Switch to a non-existent path — createClient succeeds (mocked), stat fails.
    const ghostDir = join(tmpRoot, "ghost");
    settings.update({ "zotero.data-dir": ghostDir });
    await waitFor(() => service.state === "degraded", "settle to degraded");

    // The freshly-opened client got closed; the previous one too (hot-switch).
    expect(fakeClients).toHaveLength(1);
    expect(fakeClients[0]!.$client.close).toHaveBeenCalledTimes(1);
    expect(firstClient.$client.close).toHaveBeenCalledTimes(1);

    await service[Symbol.asyncDispose]();
  });
});

describe("DatabaseService — event contract", () => {
  it("T14: changed does not fire on initial open", async () => {
    // Wire listener early by constructing manually so we observe events from
    // the very first moment.
    const persisted = {
      __VERSION__: 1,
      "zotero.data-dir": dataDir,
    };
    const plugin = new PluginStub(persisted);
    const settings = new SettingsService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await settings.ready;
    const service = new DatabaseService({ settings });
    const changed = listen(service, "changed");
    await service.ready;
    expect(changed.count).toBe(0);
    await service[Symbol.asyncDispose]();
  });

  it("T14: degraded fires exactly once on healthy → degraded; not on subsequent failures", async () => {
    const { settings, service } = await makeService();
    const degraded = listen(service, "degraded");

    const altDir = join(tmpRoot, "alt");
    await mkdir(altDir);
    await writeFile(join(altDir, "zotero.sqlite"), "alt");
    createClientMock.mockImplementation(() => {
      throw new Error("hot switch fail");
    });
    settings.update({ "zotero.data-dir": altDir });
    await waitFor(() => service.state === "degraded", "first degraded");
    expect(degraded.count).toBe(1);

    // Another failed refresh while already degraded → no re-emit.
    await service.refresh().catch(() => undefined);
    expect(degraded.count).toBe(1);

    await service[Symbol.asyncDispose]();
  });
});
