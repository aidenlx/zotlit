import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { buildSqliteUri, prepareRead } from "./read-source";
import type {
  EffectiveReadMode,
  PreparedRead,
  SourceFingerprint,
} from "./read-source";

describe("read-source", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `zotlit-read-source-test-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds SQLite file URIs with only requested query flags", () => {
    expect(buildSqliteUri(join(dir, "zotero.sqlite"), {})).toMatch(
      /^file:.*zotero\.sqlite$/,
    );
    expect(
      buildSqliteUri(join(dir, "zotero.sqlite"), {
        mode: "ro",
        immutable: true,
      }),
    ).toMatch(/[?&]mode=ro&immutable=1$/);
  });

  it("opens immutable reads against the source path", async () => {
    const source = join(dir, "zotero.sqlite");
    await using prepared = await prepareRead("immutable", source);

    expect(prepared).toMatchObject({
      path: source,
      uriOptions: { mode: "ro", immutable: true },
      effectiveMode: "immutable",
    });
  });

  it("copies the main database and WAL into an owned temp dir", async () => {
    const source = join(dir, "zotero.sqlite");
    await writeFile(source, "main");
    await writeFile(`${source}-wal`, "wal");

    const preparedPath = await (async () => {
      await using prepared = await prepareRead("copy", source);

      expect(prepared.effectiveMode).toBe("copy");
      expect(prepared.uriOptions).toEqual({ mode: "ro" });
      expect(prepared.path).not.toBe(source);
      await expect(readFile(prepared.path, "utf8")).resolves.toBe("main");
      await expect(readFile(`${prepared.path}-wal`, "utf8")).resolves.toBe(
        "wal",
      );
      return prepared.path;
    })();

    await expect(stat(preparedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("DatabaseService", () => {
  let prepareMock: ReturnType<typeof vi.fn>;
  let snapshotMock: ReturnType<typeof vi.fn>;
  let createClientMock: ReturnType<typeof vi.fn>;
  let watchMock: ReturnType<typeof vi.fn>;
  let existsSyncMock: ReturnType<typeof vi.fn>;
  let settings: FakeSettings;
  let zoteroPref: FakeZoteroPref;
  let DatabaseService: typeof import("./service").DatabaseService;
  let DatabaseError: typeof import("./service").DatabaseError;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    prepareMock = vi.fn();
    snapshotMock = vi.fn(async () => fingerprint("/zotero/zotero.sqlite"));
    createClientMock = vi.fn();
    watchMock = vi.fn(() => ({ close: vi.fn() }));
    existsSyncMock = vi.fn(() => false);

    vi.doMock("./read-source", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./read-source")>();
      return {
        ...actual,
        prepareRead: prepareMock,
        snapshotSource: snapshotMock,
      };
    });
    vi.doMock("@zotlit/db/client/node", () => ({
      createClient: createClientMock,
    }));
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        watch: watchMock,
        existsSync: existsSyncMock,
      };
    });

    ({ DatabaseService, DatabaseError } = await import("./service"));
    settings = new FakeSettings();
    zoteroPref = new FakeZoteroPref("/zotero/zotero.sqlite");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("./read-source");
    vi.doUnmock("@zotlit/db/client/node");
    vi.doUnmock("node:fs");
  });

  /** Drives the parent-directory watcher the service bound most recently. */
  function emitDirEvent(filename: string): void {
    const bindings = watchMock.mock.calls.filter(
      (call) => call[0] === "/zotero",
    );
    const listener = bindings.at(-1)?.[2] as
      | ((event: string, filename: string) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");
    listener?.("change", filename);
  }

  it("opens the configured read source during startup", async () => {
    const client = fakeClient();
    const read = prepared("/clone/zotero.sqlite", "copy");
    prepareMock.mockResolvedValueOnce(read);
    createClientMock.mockReturnValueOnce(client);

    const service = new DatabaseService(deps(settings, zoteroPref));
    {
      await using _service = service;
      await service.ready;

      expect(prepareMock).toHaveBeenCalledWith("auto", "/zotero/zotero.sqlite");
      expect(createClientMock).toHaveBeenCalledWith(
        "file:///clone/zotero.sqlite?mode=ro",
        { jit: true },
      );
      expect(service.state).toBe("ready");
      expect(service.activeReadMode).toBe("copy");
      expect(service.client).toBe(client);
    }

    expect(client.$client.close).toHaveBeenCalledOnce();
    expect(read[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it("settles ready as degraded when startup open fails", async () => {
    prepareMock.mockRejectedValueOnce(new Error("missing"));

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await expect(service.ready).resolves.toBeUndefined();

    expect(service.state).toBe("degraded");
    expect(() => service.client).toThrow(DatabaseError);
    await expect(service.refresh()).rejects.toThrow(DatabaseError);
  });

  it("keeps the active client when refresh fails", async () => {
    const firstClient = fakeClient();
    prepareMock.mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"));
    createClientMock.mockReturnValueOnce(firstClient);

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    prepareMock.mockRejectedValueOnce(new Error("busy"));
    await service.refresh();

    expect(service.state).toBe("ready");
    expect(service.client).toBe(firstClient);
    expect(firstClient.$client.close).not.toHaveBeenCalled();
  });

  it("refreshes when read mode or database path changes", async () => {
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockResolvedValueOnce(prepared("/clone/two.sqlite", "immutable"))
      .mockResolvedValueOnce(prepared("/clone/three.sqlite", "copy"));
    createClientMock
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient());

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    settings.set({ "zotero.read-mode": "immutable" });
    await waitForCallCount(prepareMock, 2);

    zoteroPref.setDatabasePath("/next/zotero.sqlite");
    await waitForCallCount(prepareMock, 3);

    expect(prepareMock.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["auto", "/zotero/zotero.sqlite"],
      ["immutable", "/zotero/zotero.sqlite"],
      ["immutable", "/next/zotero.sqlite"],
    ]);
  });

  it("keeps refreshing active across coalesced trailing reruns", async () => {
    const refreshRead = Promise.withResolvers<PreparedRead>();
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockImplementationOnce(() => refreshRead.promise)
      .mockResolvedValueOnce(prepared("/clone/three.sqlite", "copy"));
    createClientMock
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient());

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const events: boolean[] = [];
    service.on("refreshing", (active) => events.push(active));

    const firstRefresh = service.refresh();
    await waitForCallCount(prepareMock, 2);
    expect(events).toEqual([true]);

    const secondRefresh = service.refresh();
    await Promise.resolve();
    refreshRead.resolve(prepared("/clone/two.sqlite", "copy"));
    await waitForCallCount(prepareMock, 3);

    expect(events).toEqual([true]);
    await Promise.all([firstRefresh, secondRefresh]);
    expect(events).toEqual([true, false]);
  });

  it("defers refresh while a read lease is held and swaps once after release", async () => {
    const client1 = fakeClient();
    const client2 = fakeClient();
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
    createClientMock.mockReturnValueOnce(client1).mockReturnValueOnce(client2);

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const lease = await service.acquireRead();
    expect(lease.client).toBe(client1);

    const refreshDone = service.refresh();
    await Promise.resolve();
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(service.client).toBe(client1);
    expect(lease.client).toBe(client1);

    lease[Symbol.dispose]();
    await refreshDone;

    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(service.client).toBe(client2);
    // The pinned lease stays on the snapshot it captured.
    expect(lease.client).toBe(client1);
  });

  it("defers refresh until the last of overlapping leases releases", async () => {
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
    createClientMock
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient());

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const leaseA = await service.acquireRead();
    const leaseB = await service.acquireRead();

    const refreshDone = service.refresh();
    leaseA[Symbol.dispose]();
    await Promise.resolve();
    expect(prepareMock).toHaveBeenCalledTimes(1);

    leaseB[Symbol.dispose]();
    await refreshDone;
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it("resolves a deferred refresh() after the post-drain swap", async () => {
    const client2 = fakeClient();
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
    createClientMock
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(client2);

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const lease = await service.acquireRead();
    let resolved = false;
    const refreshDone = service.refresh().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    lease[Symbol.dispose]();
    await refreshDone;
    expect(resolved).toBe(true);
    expect(service.client).toBe(client2);
  });

  it("ignores lease release after the service is disposed", async () => {
    prepareMock.mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"));
    createClientMock.mockReturnValueOnce(fakeClient());

    const service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;
    const lease = await service.acquireRead();
    // Owe a refresh (via a passive trigger) so a stray release would otherwise
    // schedule it; no dangling refresh() promise, since teardown never resolves it.
    service.notifyExternalChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepareMock).toHaveBeenCalledTimes(1);

    await service[Symbol.asyncDispose]();
    prepareMock.mockClear();

    expect(() => lease[Symbol.dispose]()).not.toThrow();
    await Promise.resolve();
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("rejects acquireRead when the service is degraded", async () => {
    prepareMock.mockRejectedValueOnce(new Error("missing"));

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;
    expect(service.state).toBe("degraded");

    await expect(service.acquireRead()).rejects.toThrow(DatabaseError);
  });

  it("awaits ready before pinning the lease client", async () => {
    const startup = Promise.withResolvers<PreparedRead>();
    const client = fakeClient();
    prepareMock.mockImplementationOnce(() => startup.promise);
    createClientMock.mockReturnValueOnce(client);

    await using service = new DatabaseService(deps(settings, zoteroPref));
    const leasePromise = service.acquireRead();
    startup.resolve(prepared("/clone/one.sqlite", "copy"));

    const lease = await leasePromise;
    expect(lease.client).toBe(client);
    lease[Symbol.dispose]();
  });

  it("pins the post-swap client when a refresh is in flight at acquire", async () => {
    const refreshRead = Promise.withResolvers<PreparedRead>();
    const client1 = fakeClient();
    const client2 = fakeClient();
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockImplementationOnce(() => refreshRead.promise);
    createClientMock.mockReturnValueOnce(client1).mockReturnValueOnce(client2);

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const refreshDone = service.refresh();
    await waitForCallCount(prepareMock, 2);

    const leasePromise = service.acquireRead();
    refreshRead.resolve(prepared("/clone/two.sqlite", "copy"));

    const lease = await leasePromise;
    await refreshDone;
    expect(lease.client).toBe(client2);
    lease[Symbol.dispose]();
  });

  it("collapses watcher events during a lease into one post-drain refresh", async () => {
    prepareMock
      .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
      .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
    createClientMock
      .mockReturnValueOnce(fakeClient())
      .mockReturnValueOnce(fakeClient());

    await using service = new DatabaseService(deps(settings, zoteroPref));
    await service.ready;

    const lease = await service.acquireRead();
    service.notifyExternalChange();
    service.notifyExternalChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepareMock).toHaveBeenCalledTimes(1);

    lease[Symbol.dispose]();
    await waitForCallCount(prepareMock, 2);
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  describe("watcher self-echo gate", () => {
    /**
     * Regression: every refresh re-armed the watchers that started the next one,
     * so the plugin refreshed forever on a database nobody had touched.
     *
     * @see DatabaseService's `#scheduleWatchedRefresh` for why a tick lies.
     */
    it("ignores a watcher tick when the source is unchanged since the last read", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;
      expect(prepareMock).toHaveBeenCalledTimes(1);

      emitDirEvent("zotero.sqlite");
      emitDirEvent("zotero.sqlite-wal");
      await vi.advanceTimersByTimeAsync(2000);

      expect(prepareMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes when the watcher tick follows a real Zotero write", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      snapshotMock.mockResolvedValue(
        fingerprint("/zotero/zotero.sqlite", { size: 2n }),
      );
      emitDirEvent("zotero.sqlite");
      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 2);

      expect(prepareMock).toHaveBeenCalledTimes(2);
    });

    it("refreshes on an external push even when the source is unchanged", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      service.notifyExternalChange();
      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 2);

      expect(prepareMock).toHaveBeenCalledTimes(2);
    });

    it("refreshes when the source fingerprint cannot be read", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      snapshotMock.mockRejectedValueOnce(new Error("EIO"));
      emitDirEvent("zotero.sqlite");
      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 2);

      expect(prepareMock).toHaveBeenCalledTimes(2);
    });

    it("keeps a watcher tick armed across the rebind that follows a refresh", async () => {
      const refreshRead = Promise.withResolvers<PreparedRead>();
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockImplementationOnce(() => refreshRead.promise)
        .mockResolvedValueOnce(prepared("/clone/three.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      // Hold a refresh open past the point where it fingerprints the source, so
      // the write below is genuinely later than the snapshot this refresh reads.
      const refreshDone = service.refresh();
      await waitForCallCount(prepareMock, 2);

      // Zotero writes, and its tick arms the debounce mid-refresh. The rebind
      // that follows the swap must keep that tick, or the write stays unseen
      // until some unrelated event happens to wake the watchers again.
      snapshotMock.mockResolvedValue(
        fingerprint("/zotero/zotero.sqlite", { size: 2n }),
      );
      emitDirEvent("zotero.sqlite");
      refreshRead.resolve(prepared("/clone/two.sqlite", "copy"));
      await refreshDone;

      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 3);

      expect(prepareMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("lifetime guards", () => {
    it("drops a tick that outlives teardown inside the gate", async () => {
      const gateCheck = Promise.withResolvers<SourceFingerprint>();
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      const service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      // The timer clears itself before awaiting the gate, so teardown landing
      // in that window cannot cancel the tick. It must refuse on its own.
      snapshotMock.mockImplementationOnce(() => gateCheck.promise);
      emitDirEvent("zotero.sqlite");
      await vi.advanceTimersByTimeAsync(2000);

      await service[Symbol.asyncDispose]();
      gateCheck.resolve(fingerprint("/zotero/zotero.sqlite", { size: 2n }));
      await vi.advanceTimersByTimeAsync(0);

      expect(prepareMock).toHaveBeenCalledTimes(1);
    });

    it("cancels an untrusted tick when auto-refresh is switched off", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      snapshotMock.mockResolvedValue(
        fingerprint("/zotero/zotero.sqlite", { size: 2n }),
      );
      emitDirEvent("zotero.sqlite");
      settings.set({ "zotero.auto-refresh": false });
      await vi.advanceTimersByTimeAsync(2000);

      expect(prepareMock).toHaveBeenCalledTimes(1);
    });

    it("drops a tick that outlives the auto-refresh switch inside the gate", async () => {
      const gateCheck = Promise.withResolvers<SourceFingerprint>();
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      // Same window as teardown: once the tick is inside the gate the timer has
      // already cleared itself, so cancelling the timer cannot reach it.
      snapshotMock.mockImplementationOnce(() => gateCheck.promise);
      emitDirEvent("zotero.sqlite");
      await vi.advanceTimersByTimeAsync(2000);

      settings.set({ "zotero.auto-refresh": false });
      gateCheck.resolve(fingerprint("/zotero/zotero.sqlite", { size: 2n }));
      await vi.advanceTimersByTimeAsync(0);

      expect(prepareMock).toHaveBeenCalledTimes(1);
    });

    it("abandons a refresh whose read outlives teardown", async () => {
      const refreshRead = Promise.withResolvers<PreparedRead>();
      const lateRead = prepared("/clone/two.sqlite", "copy");
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockImplementationOnce(() => refreshRead.promise);
      // A second client is stubbed so the unguarded path runs to completion and
      // the assertions below fail on the leak itself, not on a missing mock.
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      const service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;
      const boundAtStartup = watchMock.mock.calls.length;

      // Teardown takes every handle the service knew about, then the read lands.
      // Committing it would strand a live client and a temp dir that no disposal
      // stack still owns, and rebind watchers on a service that is already gone.
      const refreshDone = service.refresh();
      await waitForCallCount(prepareMock, 2);
      await service[Symbol.asyncDispose]();

      refreshRead.resolve(lateRead);
      await refreshDone;

      expect(lateRead[Symbol.asyncDispose]).toHaveBeenCalledOnce();
      expect(createClientMock).toHaveBeenCalledTimes(1);
      expect(watchMock).toHaveBeenCalledTimes(boundAtStartup);
    });

    it("binds no watchers when teardown lands in the post-commit swap", async () => {
      const oldReadRelease = Promise.withResolvers<void>();
      const firstRead = prepared("/clone/one.sqlite", "copy");
      // Releasing the previous read closes a client and removes its clone: a
      // real await, and a second window for teardown after the commit.
      firstRead[Symbol.asyncDispose] = vi.fn(() => oldReadRelease.promise);
      prepareMock
        .mockResolvedValueOnce(firstRead)
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      const service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;
      const boundAtStartup = watchMock.mock.calls.length;
      const changed = vi.fn();
      service.on("changed", changed);

      const refreshDone = service.refresh();
      await waitForCallCount(prepareMock, 2);
      await service[Symbol.asyncDispose]();

      oldReadRelease.resolve();
      await refreshDone;

      expect(watchMock).toHaveBeenCalledTimes(boundAtStartup);
      expect(changed).not.toHaveBeenCalled();
    });

    it("reports nothing when a read fails after teardown", async () => {
      const refreshRead = Promise.withResolvers<PreparedRead>();
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockImplementationOnce(() => refreshRead.promise);
      createClientMock.mockReturnValueOnce(fakeClient());

      const service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;
      const degraded = vi.fn();
      const refreshFailed = vi.fn();
      service.on("degraded", degraded);
      service.on("refresh-failed", refreshFailed);

      const refreshDone = service.refresh();
      await waitForCallCount(prepareMock, 2);
      await service[Symbol.asyncDispose]();

      // Teardown nulled the client, so an unguarded catch would call the dead
      // service degraded and hand `refresh()` a misleading throw.
      refreshRead.reject(new Error("gone"));
      await refreshDone;

      expect(degraded).not.toHaveBeenCalled();
      expect(refreshFailed).not.toHaveBeenCalled();
      expect(service.state).toBe("ready");
    });

    it("gates the next tick again once a trusted burst has fired", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/three.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      // The push spends its authority on its own burst. A leaked flag would
      // wave every later echo through and restore the endless refresh.
      service.notifyExternalChange();
      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 2);

      emitDirEvent("zotero.sqlite");
      await vi.advanceTimersByTimeAsync(2000);

      expect(prepareMock).toHaveBeenCalledTimes(2);
    });

    it("keeps a pending push when auto-refresh is switched off", async () => {
      prepareMock
        .mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"))
        .mockResolvedValueOnce(prepared("/clone/two.sqlite", "copy"));
      createClientMock
        .mockReturnValueOnce(fakeClient())
        .mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      await service.ready;

      // A push is its own change source, so the flag must not silence it.
      service.notifyExternalChange();
      settings.set({ "zotero.auto-refresh": false });
      await vi.advanceTimersByTimeAsync(2000);
      await waitForCallCount(prepareMock, 2);

      expect(prepareMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("db-file-missing signal", () => {
    it("emits once when the database file is absent", async () => {
      existsSyncMock.mockReturnValue(false);
      prepareMock.mockRejectedValueOnce(new Error("ENOENT"));

      await using service = new DatabaseService(deps(settings, zoteroPref));
      const missing = vi.fn();
      service.on("db-file-missing", missing);
      await service.ready;

      expect(service.state).toBe("degraded");
      expect(missing).toHaveBeenCalledOnce();
    });

    it("does not emit a second time on a later same-launch failure", async () => {
      existsSyncMock.mockReturnValue(false);
      prepareMock
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockRejectedValueOnce(new Error("ENOENT"));

      await using service = new DatabaseService(deps(settings, zoteroPref));
      const missing = vi.fn();
      service.on("db-file-missing", missing);
      await service.ready;
      await expect(service.refresh()).rejects.toThrow(DatabaseError);

      expect(missing).toHaveBeenCalledOnce();
    });

    it("does not emit when the file exists (other cause)", async () => {
      existsSyncMock.mockReturnValue(true);
      prepareMock.mockRejectedValueOnce(new Error("database is locked"));

      await using service = new DatabaseService(deps(settings, zoteroPref));
      const missing = vi.fn();
      service.on("db-file-missing", missing);
      await service.ready;

      expect(service.state).toBe("degraded");
      expect(missing).not.toHaveBeenCalled();
    });

    it("emits nothing on a healthy refresh", async () => {
      prepareMock.mockResolvedValueOnce(prepared("/clone/one.sqlite", "copy"));
      createClientMock.mockReturnValueOnce(fakeClient());

      await using service = new DatabaseService(deps(settings, zoteroPref));
      const missing = vi.fn();
      service.on("db-file-missing", missing);
      await service.ready;

      expect(service.state).toBe("ready");
      expect(missing).not.toHaveBeenCalled();
    });
  });
});

type Deps = {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
};

function deps(settings: FakeSettings, zoteroPref: FakeZoteroPref): Deps {
  return { settings, zoteroPref } as unknown as Deps;
}

function prepared(
  path: string,
  effectiveMode: EffectiveReadMode,
  fallbackNotice?: PreparedRead["fallbackNotice"],
): PreparedRead {
  return {
    path,
    uriOptions: { mode: "ro" },
    effectiveMode,
    fallbackNotice,
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  };
}

function fingerprint(
  path: string,
  main: { size?: bigint } = {},
): SourceFingerprint {
  return {
    path,
    main: {
      exists: true,
      dev: 1n,
      ino: 2n,
      size: main.size ?? 1n,
      mtimeNs: 3n,
      ctimeNs: 4n,
    },
    wal: { exists: false },
  };
}

function fakeClient() {
  const close = vi.fn();
  return {
    $client: {
      close,
      [Symbol.dispose]: close,
    },
  };
}

class FakeSettings {
  #value: Settings = { ...defaults };
  readonly #subscribers = new Set<(value: Readonly<Settings> | null) => void>();

  get current(): Readonly<Settings> {
    return this.#value;
  }

  get loaded(): Promise<Readonly<Settings>> {
    return Promise.resolve(this.#value);
  }

  subscribe(cb: (value: Readonly<Settings> | null) => void): () => void {
    this.#subscribers.add(cb);
    cb(this.#value);
    return () => {
      this.#subscribers.delete(cb);
    };
  }

  set(patch: Partial<Settings>): void {
    this.#value = { ...this.#value, ...patch };
    for (const cb of this.#subscribers) cb(this.#value);
  }
}

class FakeZoteroPref {
  readonly ready = Promise.resolve();
  readonly #subscribers = new Set<() => void>();
  #databasePath: string;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  get databasePath(): string {
    return this.#databasePath;
  }

  on(event: "resolved-changed", cb: () => void): () => void {
    expect(event).toBe("resolved-changed");
    this.#subscribers.add(cb);
    return () => {
      this.#subscribers.delete(cb);
    };
  }

  setDatabasePath(path: string): void {
    this.#databasePath = path;
    for (const cb of this.#subscribers) cb();
  }
}

async function waitForCallCount(
  fn: ReturnType<typeof vi.fn>,
  count: number,
): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    if (fn.mock.calls.length >= count) return;
    await Promise.resolve();
  }
  expect(fn).toHaveBeenCalledTimes(count);
}
